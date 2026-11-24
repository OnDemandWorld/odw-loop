/**
 * Anthropic provider — native Messages API.
 */

import { request } from 'undici';
import { UpstreamError } from '@loop/types';
import type { LLMProvider, CompletionRequest, CompletionResponse, ProviderIO } from './interface.js';

const DEFAULT_TIMEOUT_MS = 120_000;

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly defaultModel?: string;

  constructor(
    private apiKey: string | undefined,
    defaultModel = 'claude-3-5-haiku-latest',
    private baseUrl: string = 'https://api.anthropic.com/v1',
    private timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this.defaultModel = defaultModel;
  }

  async complete(req: CompletionRequest, io?: ProviderIO): Promise<CompletionResponse> {
    const systemMsg = req.messages.find((m) => m.role === 'system');
    const nonSystemMsg = req.messages.filter((m) => m.role !== 'system');

    const url = `${this.baseUrl}/messages`;
    await io?.egress?.check(url);

    const response = await request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.max_tokens ?? 4096,
        ...(systemMsg ? { system: systemMsg.content } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        messages: nonSystemMsg,
      }),
      signal: io?.signal ? AbortSignal.any([io.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
    });

    if (response.statusCode >= 400) {
      const detail = await response.body.text().catch(() => '');
      throw new UpstreamError('UPSTREAM_LLM_UNAVAILABLE', `Anthropic returned ${response.statusCode}: ${detail.slice(0, 500)}`);
    }

    const data = await response.body.text().then((t) => { try { return JSON.parse(t); } catch { throw new UpstreamError('UPSTREAM_LLM_UNAVAILABLE', `${this.name} returned a non-JSON response: ${t.slice(0, 200)}`); } }) as {
      content?: Array<{ text: string }>;
      usage?: { input_tokens: number; output_tokens: number };
      stop_reason?: string;
      error?: { message?: string };
    };
    if (data.error) {
      throw new UpstreamError('UPSTREAM_LLM_UNAVAILABLE', `Anthropic returned an error: ${data.error.message ?? 'unknown'}`);
    }
    return {
      content: (data.content ?? []).map((c) => c.text ?? '').join(''),
      model: req.model,
      usage: {
        prompt_tokens: data.usage?.input_tokens ?? 0,
        completion_tokens: data.usage?.output_tokens ?? 0,
        total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
      finish_reason: data.stop_reason ?? 'end_turn',
    };
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }
}
