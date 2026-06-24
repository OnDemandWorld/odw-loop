export interface CompletionRequest {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface CompletionResponse {
  content: string;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  finish_reason: string;
}

export interface EmbeddingRequest {
  model: string;
  input: string | string[];
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage: { total_tokens: number };
}

/** LLM provider interface — every provider implements this. */
export interface LLMProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
  embed?(req: EmbeddingRequest): Promise<EmbeddingResponse>;
  isAvailable(): Promise<boolean>;
}
