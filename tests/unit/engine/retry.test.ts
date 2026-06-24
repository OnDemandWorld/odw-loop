import { describe, it, expect, vi } from 'vitest';
import { executeWithRetry, calculateBackoff } from '../../../packages/engine/src/retry';
import type { RetryConfig } from '../../../packages/engine/src/retry';

describe('executeWithRetry', () => {
  it('should succeed on first try without retries', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const config: RetryConfig = {
      max_attempts: 3,
      backoff: 'exponential',
      initial_delay_ms: 100,
    };

    const result = await executeWithRetry(fn, config);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should succeed after 2 retries', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');

    const config: RetryConfig = {
      max_attempts: 3,
      backoff: 'exponential',
      initial_delay_ms: 10,
    };

    const result = await executeWithRetry(fn, config);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should fail after max attempts exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent failure'));
    const config: RetryConfig = {
      max_attempts: 3,
      backoff: 'exponential',
      initial_delay_ms: 10,
    };

    await expect(executeWithRetry(fn, config)).rejects.toThrow('persistent failure');
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('should call onRetry callback for each retry', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');

    const config: RetryConfig = {
      max_attempts: 3,
      backoff: 'exponential',
      initial_delay_ms: 10,
    };

    const onRetry = vi.fn();

    await executeWithRetry(fn, config, onRetry);

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error));
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error));
  });

  it('should respect zero max_attempts (no retries)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const config: RetryConfig = {
      max_attempts: 0,
      backoff: 'exponential',
      initial_delay_ms: 100,
    };

    await expect(executeWithRetry(fn, config)).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('calculateBackoff', () => {
  describe('Exponential backoff', () => {
    it('should calculate exponential backoff correctly', () => {
      const baseDelay = 100;

      expect(calculateBackoff('exponential', baseDelay, 0)).toBe(100); // 100 * 2^0
      expect(calculateBackoff('exponential', baseDelay, 1)).toBe(200); // 100 * 2^1
      expect(calculateBackoff('exponential', baseDelay, 2)).toBe(400); // 100 * 2^2
      expect(calculateBackoff('exponential', baseDelay, 3)).toBe(800); // 100 * 2^3
    });

    it('should apply jitter when enabled', () => {
      const baseDelay = 100;
      const delay1 = calculateBackoff('exponential', baseDelay, 2, true);
      const delay2 = calculateBackoff('exponential', baseDelay, 2, true);

      // With jitter, delays should vary (within ±10% of 400)
      expect(delay1).toBeGreaterThanOrEqual(360);
      expect(delay1).toBeLessThanOrEqual(440);
      expect(delay2).toBeGreaterThanOrEqual(360);
      expect(delay2).toBeLessThanOrEqual(440);
      // They should likely be different (though not guaranteed due to randomness)
    });
  });

  describe('Linear backoff', () => {
    it('should calculate linear backoff correctly', () => {
      const baseDelay = 100;

      expect(calculateBackoff('linear', baseDelay, 0)).toBe(100); // 100 * (0+1)
      expect(calculateBackoff('linear', baseDelay, 1)).toBe(200); // 100 * (1+1)
      expect(calculateBackoff('linear', baseDelay, 2)).toBe(300); // 100 * (2+1)
      expect(calculateBackoff('linear', baseDelay, 3)).toBe(400); // 100 * (3+1)
    });

    it('should apply jitter when enabled', () => {
      const baseDelay = 100;
      const delay = calculateBackoff('linear', baseDelay, 2, true);

      // With jitter, delay should vary (within ±10% of 300)
      expect(delay).toBeGreaterThanOrEqual(270);
      expect(delay).toBeLessThanOrEqual(330);
    });
  });

  describe('Fixed backoff', () => {
    it('should return constant delay regardless of attempt', () => {
      const baseDelay = 100;

      expect(calculateBackoff('fixed', baseDelay, 0)).toBe(100);
      expect(calculateBackoff('fixed', baseDelay, 1)).toBe(100);
      expect(calculateBackoff('fixed', baseDelay, 2)).toBe(100);
      expect(calculateBackoff('fixed', baseDelay, 3)).toBe(100);
    });

    it('should apply jitter when enabled', () => {
      const baseDelay = 100;
      const delay = calculateBackoff('fixed', baseDelay, 5, true);

      // With jitter, delay should vary (within ±10% of 100)
      expect(delay).toBeGreaterThanOrEqual(90);
      expect(delay).toBeLessThanOrEqual(110);
    });
  });

  describe('Edge cases', () => {
    it('should handle unknown backoff strategy as fixed', () => {
      const delay = calculateBackoff('unknown', 100, 5);
      expect(delay).toBe(100);
    });

    it('should ensure delay is never negative', () => {
      const delay = calculateBackoff('exponential', 0, 0);
      expect(delay).toBe(0);
    });

    it('should round delay to nearest integer', () => {
      const delay = calculateBackoff('linear', 100, 0, true);
      expect(Number.isInteger(delay)).toBe(true);
    });
  });
});
