/**
 * Azure OpenAI provider — deployment-based chat completions.
 */

import { request } from 'undici';
import { UpstreamError } from '@loop/types';
import type { LLMProvider, CompletionRequest, CompletionResponse, ProviderIO } from './interface.js';

const DEFAULT_TIMEOUT_MS = 120_000;

export class AzureOpenAIProvider implements LLMProvider {
  readonly name = 'azure';
  readonly defaultModel?: string;

  constructor(
    private endpoint: string,
    private apiKey: string | undefined,
    defaultModel?: string,
    private apiVersion: string = '2024-02-15-preview',
    private timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this.defaultModel = defaultModel;
  }

  async complete(req: CompletionRequest, io?: ProviderIO): Promise<CompletionResponse> {
    const url = `${this.endpoint}/openai/deployments/${encodeURIComponent(req.model)}/chat/completions?api-version=${this.apiVersion}`;
    await io?.egress?.check(url);

    const response = await request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'api-key': this.apiKey ?? '',
      },
      body: JSON.stringify({ messages: req.messages, temperature: req.temperature, max_tokens: req.max_tokens }),
      signal: io?.signal ?? AbortSignal.timeout(this.timeoutMs),
    });

    if (response.statusCode >= 400) {
      const detail = await response.body.text().catch(() => '');
      throw new UpstreamError('UPSTREAM_LLM_UNAVAILABLE', `Azure OpenAI returned ${response.statusCode}: ${detail.slice(0, 500)}`);
    }

    const data = await response.body.json() as {
      choices?: Array<{ message?: { content: string }; finish_reason?: string }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    return {
      content: data.choices?.[0]?.message?.content ?? '',
      model: req.model,
      usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      finish_reason: data.choices?.[0]?.finish_reason ?? 'stop',
    };
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey && !!this.endpoint;
  }
}
