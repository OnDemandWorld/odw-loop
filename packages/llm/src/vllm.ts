/**
 * vLLM local provider — an OpenAI-compatible server preset.
 */

import { OpenAICompatibleProvider } from './openai.js';
import type { LLMProvider, CompletionRequest, CompletionResponse, ProviderIO } from './interface.js';

export class VLLMProvider implements LLMProvider {
  readonly name = 'vllm';
  readonly defaultModel?: string;
  private inner: OpenAICompatibleProvider;

  constructor(baseUrl: string = 'http://localhost:8000/v1', defaultModel?: string, timeoutMs?: number) {
    this.inner = new OpenAICompatibleProvider('vllm', undefined, baseUrl, defaultModel ?? 'local-model', timeoutMs);
    this.defaultModel = this.inner.defaultModel;
  }

  async complete(req: CompletionRequest, io?: ProviderIO): Promise<CompletionResponse> {
    return this.inner.complete(req, io);
  }

  async isAvailable(): Promise<boolean> {
    return this.inner.isAvailable();
  }
}
