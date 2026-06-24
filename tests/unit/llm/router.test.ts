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
});
