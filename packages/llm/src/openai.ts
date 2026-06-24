/**
 * OpenAI provider.
 */

import { request } from 'undici';
import type { LLMProvider, CompletionRequest, CompletionResponse } from './interface.js';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';

  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://api.openai.com/v1',
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const response = await request(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        temperature: req.temperature,
        max_tokens: req.max_tokens,
        stream: false,
      }),
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
    return !!this.apiKey;
  }
}
