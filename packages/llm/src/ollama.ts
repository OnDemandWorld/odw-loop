/**
 * Ollama local LLM provider.
 */

import { request } from 'undici';
import type { LLMProvider, CompletionRequest, CompletionResponse, EmbeddingRequest, EmbeddingResponse } from './interface.js';

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';

  constructor(private baseUrl: string = 'http://localhost:11434') {}

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const response = await request(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: false,
        options: { temperature: req.temperature, num_predict: req.max_tokens },
      }),
    });
    const data = await response.body.json() as { message?: { content: string }; eval_count?: number; prompt_eval_count?: number };
    return {
      content: data.message?.content ?? '',
      model: req.model,
      usage: {
        prompt_tokens: data.prompt_eval_count ?? 0,
        completion_tokens: data.eval_count ?? 0,
        total_tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
      finish_reason: 'stop',
    };
  }

  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    const inputs = Array.isArray(req.input) ? req.input : [req.input];
    const embeddings: number[][] = [];
    for (const text of inputs) {
      const response = await request(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: req.model, prompt: text }),
      });
      const data = await response.body.json() as { embedding: number[] };
      embeddings.push(data.embedding);
    }
    return { embeddings, model: req.model, usage: { total_tokens: 0 } };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await request(`${this.baseUrl}/api/tags`, { method: 'GET' });
      return response.statusCode === 200;
    } catch {
      return false;
    }
  }
}
