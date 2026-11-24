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
    // Audit #123: a real default model — the router previously sent the
    // literal 'default', which Ollama 404s. Operators can override with
    // LOOP_LLM_OLLAMA_MODEL; llama3.2 is a common small local model.
    this.defaultModel = defaultModel ?? 'llama3.2';
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
      signal: io?.signal ? AbortSignal.any([io.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
    });

    if (response.statusCode >= 400) {
      const detail = await response.body.text().catch(() => '');
      throw new UpstreamError('UPSTREAM_LLM_UNAVAILABLE', `Ollama returned ${response.statusCode}: ${detail.slice(0, 500)}`);
    }

    const data = await response.body.text().then((t) => { try { return JSON.parse(t); } catch { throw new UpstreamError('UPSTREAM_LLM_UNAVAILABLE', `${this.name} returned a non-JSON response: ${t.slice(0, 200)}`); } }) as {
      message?: { content: string };
      error?: string;
      eval_count?: number;
      prompt_eval_count?: number;
      done_reason?: string;
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
      // Audit #125: surface truncation — done_reason 'length' means the answer
      // was cut mid-sentence by num_predict/max_tokens.
      finish_reason: data.done_reason === 'length' ? 'length' : 'stop',
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
      signal: io?.signal ? AbortSignal.any([io.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
    });
    if (response.statusCode >= 400) {
      const detail = await response.body.text().catch(() => '');
      throw new UpstreamError('UPSTREAM_LLM_UNAVAILABLE', `Ollama embed returned ${response.statusCode}: ${detail.slice(0, 500)}`);
    }
    const data = await response.body.text().then((t) => { try { return JSON.parse(t); } catch { throw new UpstreamError('UPSTREAM_LLM_UNAVAILABLE', `${this.name} returned a non-JSON response: ${t.slice(0, 200)}`); } }) as { embeddings?: number[][]; prompt_eval_count?: number };
    // Audit #126: report real embedding token usage (was hardcoded 0).
    return { embeddings: data.embeddings ?? [], model: req.model, usage: { total_tokens: data.prompt_eval_count ?? 0 } };
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
