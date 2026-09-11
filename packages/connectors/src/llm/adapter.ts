/**
 * LLM connector — lets workflows call AI models as a normal node type
 * (`llm.complete`). All vendor keys stay server-side in the LLMRouter;
 * workflow definitions only reference providers/models by name, never
 * credentials.
 *
 * Node config (input):
 *   - prompt: string               — single-turn shorthand (or use messages)
 *   - system?: string              — system instruction
 *   - messages?: ChatMessage[]     — full conversation (overrides prompt)
 *   - provider?: string            — preferred vendor (falls back to the
 *                                    configured chain if it fails)
 *   - model?: string               — model/deployment name (else vendor default)
 *   - temperature?, max_tokens?
 *
 * Output: { content, model, usage, finish_reason }
 */

import type { ConnectorAdapter, ExecuteParams, ExecuteResult } from '../interface.js';
import type { ConnectorCapabilities } from '@loop/types';
import { LoopError } from '@loop/types';
import type { LLMRouter, CompletionRequest, ChatMessage } from '@loop/llm';

export class LlmConnectorAdapter implements ConnectorAdapter {
  readonly type = 'llm';

  constructor(private router: LLMRouter) {}

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    if (params.operation !== 'complete') {
      throw new LoopError('VALIDATION_REQUIRED', `Unknown LLM operation: ${params.operation} (supported: 'complete')`, 400);
    }

    const input = params.input;
    const messages = this.resolveMessages(input);

    // Per-node provider preference: try it first, then every other configured
    // vendor as fallback (the router skips open circuits).
    const provider = typeof input['provider'] === 'string' && input['provider'].length > 0 ? input['provider'] : undefined;
    const chain = provider
      ? [provider, ...this.router.listProviders().map((p) => p.name).filter((n) => n !== provider)]
      : undefined;

    const request: CompletionRequest = {
      // Empty model = "use each vendor's default"; the router resolves it.
      model: typeof input['model'] === 'string' ? input['model'] : '',
      messages,
      ...(typeof input['temperature'] === 'number' ? { temperature: input['temperature'] } : {}),
      ...(typeof input['max_tokens'] === 'number' ? { max_tokens: input['max_tokens'] } : {}),
    };

    const result = await this.router.complete(request, chain, {
      egress: params.egress,
      signal: params.signal,
    });

    return {
      output: {
        content: result.content,
        model: result.model,
        usage: result.usage,
        finish_reason: result.finish_reason,
      },
    };
  }

  /** Build the chat messages from `messages` or the `prompt`/`system` shorthand. */
  private resolveMessages(input: Record<string, unknown>): ChatMessage[] {
    const raw = input['messages'];
    if (Array.isArray(raw)) {
      const messages: ChatMessage[] = [];
      for (const m of raw) {
        const entry = m as { role?: unknown; content?: unknown };
        if (
          typeof entry?.role !== 'string' ||
          !['system', 'user', 'assistant'].includes(entry.role) ||
          typeof entry?.content !== 'string'
        ) {
          throw new LoopError('VALIDATION_TYPE_MISMATCH', 'messages entries must be { role: system|user|assistant, content: string }', 400);
        }
        messages.push({ role: entry.role as ChatMessage['role'], content: entry.content });
      }
      if (messages.length === 0) {
        throw new LoopError('VALIDATION_REQUIRED', 'messages must not be empty', 400);
      }
      return messages;
    }

    const prompt = input['prompt'];
    if (typeof prompt !== 'string' || prompt.length === 0) {
      throw new LoopError('VALIDATION_REQUIRED', "llm.complete requires either 'prompt' or 'messages'", 400);
    }
    const system = input['system'];
    const messages: ChatMessage[] = [];
    if (typeof system === 'string' && system.length > 0) {
      messages.push({ role: 'system', content: system });
    }
    messages.push({ role: 'user', content: prompt });
    return messages;
  }

  async healthCheck(): Promise<boolean> {
    return this.router.listProviders().length > 0;
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      node_types: ['llm.complete'],
      input_types: ['string', 'ChatMessage[]'],
      output_types: ['string'],
    };
  }
}
