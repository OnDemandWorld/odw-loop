/**
 * Anthropic provider.
 */

import { request } from 'undici';
import type { LLMProvider, CompletionRequest, CompletionResponse } from './interface.js';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';

  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://api.anthropic.com/v1',
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const systemMsg = req.messages.find((m) => m.role === 'system');
    const nonSystemMsg = req.messages.filter((m) => m.role !== 'system');

    const response = await request(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.max_tokens ?? 4096,
        system: systemMsg?.content,
        messages: nonSystemMsg,
      }),
    });
    const data = await response.body.json() as {
      content?: Array<{ text: string }>;
      usage?: { input_tokens: number; output_tokens: number };
      stop_reason?: string;
    };
    return {
      content: data.content?.[0]?.text ?? '',
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
