/**
 * Azure OpenAI provider.
 */

import { request } from 'undici';
import type { LLMProvider, CompletionRequest, CompletionResponse } from './interface.js';

export class AzureOpenAIProvider implements LLMProvider {
  readonly name = 'azure';

  constructor(
    private endpoint: string,
    private apiKey: string,
    private apiVersion: string = '2024-02-15-preview',
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const url = `${this.endpoint}/openai/deployments/${req.model}/chat/completions?api-version=${this.apiVersion}`;
    const response = await request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify({ messages: req.messages, temperature: req.temperature, max_tokens: req.max_tokens }),
    });
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
