/**
 * Ollama local LLM provider — native `/api/chat` + `/api/embed`.
 */

import { request } from 'undici';
import { UpstreamError } from '@loop/types';
import type { LLMProvider, CompletionRequest, CompletionResponse, EmbeddingRequest, EmbeddingResponse, ProviderIO } from './interface.js';

const DEFAULT_TIMEOUT_MS = 300_000; // local models can be slow on cold start

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  readonly defaultModel?: string;

  constructor(
    private baseUrl: string = 'http://localhost:11434',
    defaultModel?: string,
    private timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this.defaultModel = defaultModel;
  }

  async complete(req: CompletionRequest, io?: ProviderIO): Promise<CompletionResponse> {
    const url = `${this.baseUrl}/api/chat`;
    await io?.egress?.check(url);

    const response = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: false,
        options: { temperature: req.temperature, num_predict: req.max_tokens },
      }),
      signal: io?.signal ?? AbortSignal.timeout(this.timeoutMs),
    });

    if (response.statusCode >= 400) {
      const detail = await response.body.text().catch(() => '');
      throw new UpstreamError('UPSTREAM_LLM_UNAVAILABLE', `Ollama returned ${response.statusCode}: ${detail.slice(0, 500)}`);
    }

    const data = await response.body.json() as {
      message?: { content: string };
      error?: string;
      eval_count?: number;
      prompt_eval_count?: number;
    };
    if (data.error) {
      throw new UpstreamError('UPSTREAM_LLM_UNAVAILABLE', `Ollama returned an error: ${data.error}`);
    }
    return {
      content: data.message?.content ?? '',
      model: req.model,
      usage: {
        prompt_tokens: data.prompt_eval_count ?? 0,
        completion_tokens: data.eval_count ?? 0,
        total_tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
      finish_reason: 'stop',
    };
  }

  async embed(req: EmbeddingRequest, io?: ProviderIO): Promise<EmbeddingResponse> {
    const inputs = Array.isArray(req.input) ? req.input : [req.input];
    const url = `${this.baseUrl}/api/embed`;
    await io?.egress?.check(url);

    const response = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: req.model, input: inputs }),
      signal: io?.signal ?? AbortSignal.timeout(this.timeoutMs),
    });
    if (response.statusCode >= 400) {
      const detail = await response.body.text().catch(() => '');
      throw new UpstreamError('UPSTREAM_LLM_UNAVAILABLE', `Ollama embed returned ${response.statusCode}: ${detail.slice(0, 500)}`);
    }
    const data = await response.body.json() as { embeddings?: number[][] };
    return { embeddings: data.embeddings ?? [], model: req.model, usage: { total_tokens: 0 } };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await request(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
      // Drain the body so the socket is released.
      await response.body.text().catch(() => {});
      return response.statusCode === 200;
    } catch {
      return false;
    }
  }
}
