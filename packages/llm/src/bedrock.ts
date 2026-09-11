/**
 * AWS Bedrock provider (stub — full implementation requires AWS SDK).
 */

import type { LLMProvider, CompletionRequest, CompletionResponse } from './interface.js';

export class BedrockProvider implements LLMProvider {
  readonly name = 'bedrock';

  constructor(
    private region: string,
    private _accessKeyId?: string,
    private _secretAccessKey?: string,
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    // Bedrock requires AWS SDK — stub returns empty for now.
    // Developer task: integrate @aws-sdk/client-bedrock-runtime.
    return {
      content: '',
      model: req.model,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      finish_reason: 'stop',
    };
  }

  async isAvailable(): Promise<boolean> {
    // Stub: reports unavailable until the AWS SDK integration lands —
    // claiming availability made the router select it and silently return
    // empty completions.
    return false;
  }
}
