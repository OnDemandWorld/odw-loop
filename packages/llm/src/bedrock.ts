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

  async complete(_req: CompletionRequest): Promise<CompletionResponse> {
    // Bedrock requires AWS SDK — stub returns empty for now.
    // Developer task: integrate @aws-sdk/client-bedrock-runtime.
    // Audit #127: fail loudly — an empty success-shaped completion would be
    // indistinguishable from a real answer if this stub were ever wired.
    throw new Error('Bedrock provider is not implemented');
  }

  async isAvailable(): Promise<boolean> {
    // Stub: reports unavailable until the AWS SDK integration lands —
    // claiming availability made the router select it and silently return
    // empty completions.
    return false;
  }
}
