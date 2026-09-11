export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
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

/**
 * IO handles threaded from the executor so provider HTTP calls honour the
 * same egress gate and timeout signal as every other outbound connector.
 */
export interface ProviderIO {
  egress?: { check(url: string): Promise<void> };
  signal?: AbortSignal;
}

/** LLM provider interface — every provider implements this. */
export interface LLMProvider {
  readonly name: string;
  /** Model used when a request does not name one (per-vendor default). */
  readonly defaultModel?: string;
  complete(req: CompletionRequest, io?: ProviderIO): Promise<CompletionResponse>;
  embed?(req: EmbeddingRequest, io?: ProviderIO): Promise<EmbeddingResponse>;
  isAvailable(): Promise<boolean>;
}
