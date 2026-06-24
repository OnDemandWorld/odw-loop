/**
 * vLLM local provider — OpenAI-compatible API.
 */

import { OpenAIProvider } from './openai.js';
import type { LLMProvider, CompletionRequest, CompletionResponse } from './interface.js';

export class VLLMProvider implements LLMProvider {
  readonly name = 'vllm';
  private inner: OpenAIProvider;

  constructor(baseUrl: string = 'http://localhost:8000/v1') {
    this.inner = new OpenAIProvider('not-needed', baseUrl);
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    return this.inner.complete(req);
  }

  async isAvailable(): Promise<boolean> {
    return true; // vLLM is local, assumed available if URL is set
  }
}
