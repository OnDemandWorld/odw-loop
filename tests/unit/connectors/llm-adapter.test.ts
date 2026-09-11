/**
 * LlmConnectorAdapter tests — the workflow `llm.complete` node.
 */

import { describe, it, expect, vi } from 'vitest';
import { LlmConnectorAdapter } from '../../../packages/connectors/src/llm/adapter';
import type { LLMRouter, CompletionRequest, CompletionResponse, ProviderIO } from '../../../packages/llm/src/interface';

function fakeRouter(response?: Partial<CompletionResponse>) {
  const calls: Array<{ req: CompletionRequest; chain?: string[]; io?: ProviderIO }> = [];
  const router = {
    complete: vi.fn(async (req: CompletionRequest, chain?: string[], io?: ProviderIO) => {
      calls.push({ req, chain, io });
      return {
        content: 'ai says hi',
        model: 'deepseek-chat',
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        finish_reason: 'stop',
        ...response,
      };
    }),
    listProviders: vi.fn(() => [
      { name: 'deepseek', circuit: 'closed', failures: 0 },
      { name: 'ollama', circuit: 'closed', failures: 0 },
    ]),
  } as unknown as LLMRouter & { complete: ReturnType<typeof vi.fn>; listProviders: ReturnType<typeof vi.fn> };
  return { router, calls };
}

describe('LlmConnectorAdapter (llm.complete node)', () => {
  it('maps prompt+system to messages and passes the forced provider first', async () => {
    const { router, calls } = fakeRouter();
    const adapter = new LlmConnectorAdapter(router);

    const result = await adapter.execute({
      operation: 'complete',
      input: { prompt: '总结这段话', system: '你是助手', provider: 'deepseek', model: 'deepseek-chat', temperature: 0.2 },
    });

    expect(result.output.content).toBe('ai says hi');
    expect(result.output.model).toBe('deepseek-chat');
    const call = calls[0]!;
    expect(call.req.messages).toEqual([
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '总结这段话' },
    ]);
    expect(call.chain?.[0]).toBe('deepseek');
    expect(call.chain).toContain('ollama'); // other configured vendors as fallback
    expect(call.req.temperature).toBe(0.2);
  });

  it('uses raw messages when provided and forwards egress/signal', async () => {
    const { router, calls } = fakeRouter();
    const adapter = new LlmConnectorAdapter(router);
    const signal = new AbortController().signal;
    const egress = { check: vi.fn().mockResolvedValue(undefined) };

    await adapter.execute({
      operation: 'complete',
      input: { messages: [{ role: 'user', content: 'hello' }] },
      egress,
      signal,
    });

    expect(calls[0]!.req.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(calls[0]!.io?.signal).toBe(signal);
    // The router owns the URL; the adapter forwards the gate untouched.
    expect(calls[0]!.io?.egress).toBe(egress);
  });

  it('empty model is allowed — the router resolves vendor defaults', async () => {
    const { router, calls } = fakeRouter();
    const adapter = new LlmConnectorAdapter(router);
    await adapter.execute({ operation: 'complete', input: { prompt: 'hi' } });
    expect(calls[0]!.req.model).toBe('');
    expect(calls[0]!.chain).toBeUndefined(); // configured chain order
  });

  it('rejects invalid messages and missing prompt/messages', async () => {
    const { router } = fakeRouter();
    const adapter = new LlmConnectorAdapter(router);

    await expect(adapter.execute({ operation: 'complete', input: {} }))
      .rejects.toMatchObject({ code: 'VALIDATION_REQUIRED' });
    await expect(adapter.execute({ operation: 'complete', input: { messages: [{ role: 'wizard', content: 'x' }] } }))
      .rejects.toMatchObject({ code: 'VALIDATION_TYPE_MISMATCH' });
    await expect(adapter.execute({ operation: 'complete', input: { messages: [] } }))
      .rejects.toMatchObject({ code: 'VALIDATION_REQUIRED' });
  });

  it('rejects unknown operations', async () => {
    const { router } = fakeRouter();
    const adapter = new LlmConnectorAdapter(router);
    await expect(adapter.execute({ operation: 'embed', input: {} }))
      .rejects.toMatchObject({ code: 'VALIDATION_REQUIRED' });
  });

  it('advertises the llm.complete node type', () => {
    const { router } = fakeRouter();
    const adapter = new LlmConnectorAdapter(router);
    expect(adapter.type).toBe('llm');
    expect(adapter.getCapabilities().node_types).toContain('llm.complete');
  });
});
