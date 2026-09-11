/**
 * Google Vertex AI provider (stub — full implementation requires Google Cloud SDK).
 */

import type { LLMProvider, CompletionRequest, CompletionResponse } from './interface.js';

export class VertexProvider implements LLMProvider {
  readonly name = 'vertex';

  constructor(
    private project: string,
    private _location: string = 'us-central1',
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    // Vertex requires Google Cloud SDK — stub returns empty for now.
    // Developer task: integrate @google-cloud/aiplatform.
    return {
      content: '',
      model: req.model,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      finish_reason: 'stop',
    };
  }

  async isAvailable(): Promise<boolean> {
    // Stub: reports unavailable until the Google Cloud SDK integration lands —
    // claiming availability made the router select it and silently return
    // empty completions. (Gemini is available natively — see gemini.ts.)
    return false;
  }
}
