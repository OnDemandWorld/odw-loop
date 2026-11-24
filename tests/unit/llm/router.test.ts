import { describe, it, expect, vi } from 'vitest';
import { LLMRouter } from '../../../packages/llm/src/router';
import type { LLMProvider, CompletionRequest, CompletionResponse } from '../../../packages/llm/src/interface';

describe('LLMRouter', () => {
  it('falls through to next provider on failure', async () => {
    const failingProvider: LLMProvider = {
      name: 'failing',
      complete: vi.fn().mockRejectedValue(new Error('Provider failed')),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const successProvider: LLMProvider = {
      name: 'success',
      complete: vi.fn().mockResolvedValue({
        content: 'success response',
        model: 'test-model',
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        finish_reason: 'stop',
      }),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const router = new LLMRouter([failingProvider, successProvider]);
    const req: CompletionRequest = { model: 'test', messages: [{ role: 'user', content: 'test' }] };

    const result = await router.complete(req);

    expect(result.content).toBe('success response');
    expect(failingProvider.complete).toHaveBeenCalledTimes(1);
    expect(successProvider.complete).toHaveBeenCalledTimes(1);
  });

  it('circuit breaker opens after threshold (5 failures)', async () => {
    const failingProvider: LLMProvider = {
      name: 'failing',
      complete: vi.fn().mockRejectedValue(new Error('Provider failed')),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const fallbackProvider: LLMProvider = {
      name: 'fallback',
      complete: vi.fn().mockResolvedValue({
        content: 'fallback response',
        model: 'test-model',
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        finish_reason: 'stop',
      }),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const router = new LLMRouter([failingProvider, fallbackProvider]);
    const req: CompletionRequest = { model: 'test', messages: [{ role: 'user', content: 'test' }] };

    // Fire 5 requests to trigger circuit breaker
    for (let i = 0; i < 5; i++) {
      await router.complete(req);
    }

    // 6th request should skip failing provider
    await router.complete(req);

    expect(failingProvider.complete).toHaveBeenCalledTimes(5);
    expect(fallbackProvider.complete).toHaveBeenCalledTimes(6);
  });

  it('circuit breaker half-open after cooldown', async () => {
    const failingProvider: LLMProvider = {
      name: 'failing',
      complete: vi.fn()
        .mockRejectedValueOnce(new Error('Provider failed'))
        .mockRejectedValueOnce(new Error('Provider failed'))
        .mockRejectedValueOnce(new Error('Provider failed'))
        .mockRejectedValueOnce(new Error('Provider failed'))
        .mockRejectedValueOnce(new Error('Provider failed'))
        .mockResolvedValueOnce({
          content: 'recovered',
          model: 'test-model',
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          finish_reason: 'stop',
        }),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const fallbackProvider: LLMProvider = {
      name: 'fallback',
      complete: vi.fn().mockResolvedValue({
        content: 'fallback',
        model: 'test-model',
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        finish_reason: 'stop',
      }),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const router = new LLMRouter([failingProvider, fallbackProvider]);
    const req: CompletionRequest = { model: 'test', messages: [{ role: 'user', content: 'test' }] };

    // Fire 5 requests to open circuit
    for (let i = 0; i < 5; i++) {
      await router.complete(req);
    }

    // Advance time by 31 seconds (cooldown is 30s)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);

    // Next request should try failing provider again (half-open)
    const result = await router.complete(req);

    expect(result.content).toBe('recovered');
    expect(failingProvider.complete).toHaveBeenCalledTimes(6);
  });

  it('successful request resets circuit', async () => {
    let shouldFail = true;
    const provider: LLMProvider = {
      name: 'provider',
      complete: vi.fn().mockImplementation(async () => {
        if (shouldFail) throw new Error('Provider failed');
        return {
          content: 'success',
          model: 'test-model',
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          finish_reason: 'stop',
        };
      }),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const fallbackProvider: LLMProvider = {
      name: 'fallback',
      complete: vi.fn().mockResolvedValue({
        content: 'fallback',
        model: 'test-model',
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        finish_reason: 'stop',
      }),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const router = new LLMRouter([provider, fallbackProvider]);
    const req: CompletionRequest = { model: 'test', messages: [{ role: 'user', content: 'test' }] };

    // Fail 4 times (below threshold)
    for (let i = 0; i < 4; i++) {
      await router.complete(req);
    }

    // Next request succeeds
    shouldFail = false;
    await router.complete(req);

    // Circuit should be reset, so next 5 requests should all go to primary provider
    for (let i = 0; i < 5; i++) {
      await router.complete(req);
    }

    expect(provider.complete).toHaveBeenCalledTimes(10);
    expect(fallbackProvider.complete).toHaveBeenCalledTimes(4);
  });

  it('audit #20: an explicit chain is exclusive — no fallthrough to other vendors', async () => {
    const localProvider: LLMProvider = {
      name: 'local',
      complete: vi.fn().mockRejectedValue(new Error('egress blocked')),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    const cloudProvider: LLMProvider = {
      name: 'cloud',
      complete: vi.fn().mockResolvedValue({
        content: 'cloud response',
        model: 'test-model',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        finish_reason: 'stop',
      }),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    const router = new LLMRouter([localProvider, cloudProvider]);
    const req: CompletionRequest = { model: 'test', messages: [{ role: 'user', content: 'confidential' }] };

    // Forced-provider route passes chain=[provider]; a failure must surface,
    // not silently send the prompt to another vendor.
    await expect(router.complete(req, ['local'])).rejects.toThrow('egress blocked');
    expect(cloudProvider.complete).not.toHaveBeenCalled();
  });
});

describe('LLMRouter — failure classification (audit #52)', () => {
  it('egress policy denials do not open the circuit', async () => {
    const { LoopError } = await import('../../../packages/types/src/errors');
    const blocked: LLMProvider = {
      name: 'blocked',
      complete: vi.fn().mockRejectedValue(new LoopError('NODE_EGRESS_BLOCKED', 'Egress blocked: airgap', 403)),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    const router = new LLMRouter([blocked]);
    const req: CompletionRequest = { model: 'test', messages: [{ role: 'user', content: 'x' }] };

    // More than the threshold (5) denials must NOT open the circuit.
    for (let i = 0; i < 7; i++) {
      await expect(router.complete(req)).rejects.toThrow(/Egress blocked/);
    }
    // The error surfaces as the policy denial, not 'No LLM providers available'.
    await expect(router.complete(req)).rejects.toMatchObject({ code: 'NODE_EGRESS_BLOCKED' });
  });

  it('an aborted signal stops the chain instead of failing every provider', async () => {
    const controller = new AbortController();
    controller.abort();
    const first: LLMProvider = {
      name: 'first',
      complete: vi.fn().mockRejectedValue(new Error('aborted')),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    const second: LLMProvider = {
      name: 'second',
      complete: vi.fn().mockResolvedValue({
        content: 'should not run', model: 'm',
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, finish_reason: 'stop',
      }),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    const router = new LLMRouter([first, second]);
    const req: CompletionRequest = { model: 'test', messages: [{ role: 'user', content: 'x' }] };
    await expect(router.complete(req, undefined, { signal: controller.signal })).rejects.toThrow('aborted');
    expect(second.complete).not.toHaveBeenCalled();
  });
});

describe('LLMRouter — availability gating (audit #127)', () => {
  it('skips unavailable providers instead of returning their empty answers', async () => {
    const unavailable: LLMProvider = {
      name: 'unavailable',
      complete: vi.fn().mockResolvedValue({
        content: '', model: 'm',
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, finish_reason: 'stop',
      }),
      isAvailable: vi.fn().mockResolvedValue(false),
    };
    const good: LLMProvider = {
      name: 'good',
      complete: vi.fn().mockResolvedValue({
        content: 'real answer', model: 'm',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, finish_reason: 'stop',
      }),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    const router = new LLMRouter([unavailable, good]);
    const result = await router.complete({ model: '', messages: [{ role: 'user', content: 'hi' }] });
    expect(result.content).toBe('real answer');
    expect(unavailable.complete).not.toHaveBeenCalled();
  });
});
