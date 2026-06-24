import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker } from '../../../packages/engine/src/circuitBreaker';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker('test-circuit', 3, 1000); // threshold=3, cooldown=1000ms
  });

  describe('CLOSED state', () => {
    it('should start in CLOSED state', () => {
      expect(cb.getState()).toBe('closed');
    });

    it('should pass requests through in CLOSED state', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await cb.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(cb.getState()).toBe('closed');
    });

    it('should allow multiple successful requests', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      await cb.execute(fn);
      await cb.execute(fn);
      await cb.execute(fn);

      expect(fn).toHaveBeenCalledTimes(3);
      expect(cb.getState()).toBe('closed');
    });
  });

  describe('Transition to OPEN', () => {
    it('should transition to OPEN after threshold failures', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(cb.execute(fn)).rejects.toThrow('fail');
      expect(cb.getState()).toBe('closed');
      expect(cb.getState() === 'closed').toBe(true);

      await expect(cb.execute(fn)).rejects.toThrow('fail');
      expect(cb.getState()).toBe('closed');

      await expect(cb.execute(fn)).rejects.toThrow('fail');
      expect(cb.getState()).toBe('open');
    });

    it('should not transition to OPEN before reaching threshold', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(cb.execute(fn)).rejects.toThrow('fail');
      expect(cb.getState()).toBe('closed');

      await expect(cb.execute(fn)).rejects.toThrow('fail');
      expect(cb.getState()).toBe('closed');
    });
  });

  describe('OPEN state', () => {
    it('should reject requests immediately when OPEN', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Trigger OPEN state
      await expect(cb.execute(fn)).rejects.toThrow('fail');
      await expect(cb.execute(fn)).rejects.toThrow('fail');
      await expect(cb.execute(fn)).rejects.toThrow('fail');

      // Now should reject without calling fn
      const successFn = vi.fn().mockResolvedValue('success');
      await expect(cb.execute(successFn)).rejects.toThrow(/Circuit breaker .* is open/);
      expect(successFn).not.toHaveBeenCalled();
    });

    it('should stay OPEN within cooldown period', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Trigger OPEN state
      await expect(cb.execute(fn)).rejects.toThrow('fail');
      await expect(cb.execute(fn)).rejects.toThrow('fail');
      await expect(cb.execute(fn)).rejects.toThrow('fail');

      expect(cb.getState()).toBe('open');

      // Try immediately (within cooldown)
      const testFn = vi.fn().mockResolvedValue('success');
      await expect(cb.execute(testFn)).rejects.toThrow(/is open/);
      expect(testFn).not.toHaveBeenCalled();
    });
  });

  describe('Transition to HALF_OPEN', () => {
    it('should transition to HALF_OPEN after cooldown', async () => {
      const cbShort = new CircuitBreaker('test', 2, 50); // 50ms cooldown
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Trigger OPEN state
      await expect(cbShort.execute(fn)).rejects.toThrow('fail');
      await expect(cbShort.execute(fn)).rejects.toThrow('fail');
      expect(cbShort.getState()).toBe('open');

      // Wait for cooldown
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should transition to HALF_OPEN on next call
      const successFn = vi.fn().mockResolvedValue('success');
      const result = await cbShort.execute(successFn);

      expect(result).toBe('success');
      expect(cbShort.getState()).toBe('closed');
      expect(successFn).toHaveBeenCalled();
    });
  });

  describe('HALF_OPEN state', () => {
    it('should transition to CLOSED on successful test request', async () => {
      const cbShort = new CircuitBreaker('test', 1, 50);
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));

      // Trigger OPEN state
      await expect(cbShort.execute(failFn)).rejects.toThrow('fail');
      expect(cbShort.getState()).toBe('open');

      // Wait for cooldown
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Successful test request should close circuit
      const successFn = vi.fn().mockResolvedValue('success');
      await cbShort.execute(successFn);

      expect(cbShort.getState()).toBe('closed');
    });

    it('should transition back to OPEN on failed test request', async () => {
      const cbShort = new CircuitBreaker('test', 1, 50);
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));

      // Trigger OPEN state
      await expect(cbShort.execute(failFn)).rejects.toThrow('fail');
      expect(cbShort.getState()).toBe('open');

      // Wait for cooldown
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Failed test request should reopen circuit
      await expect(cbShort.execute(failFn)).rejects.toThrow('fail');
      expect(cbShort.getState()).toBe('open');
    });

    it('should reset failure count on successful HALF_OPEN request', async () => {
      const cbShort = new CircuitBreaker('test', 2, 50);
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));

      // Trigger OPEN state with 2 failures (reaching threshold)
      await expect(cbShort.execute(failFn)).rejects.toThrow('fail');
      expect(cbShort.getState()).toBe('closed');
      await expect(cbShort.execute(failFn)).rejects.toThrow('fail');
      expect(cbShort.getState()).toBe('open');

      // Wait for cooldown
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Successful request should reset counter and close circuit
      const successFn = vi.fn().mockResolvedValue('success');
      await cbShort.execute(successFn);
      expect(cbShort.getState()).toBe('closed');

      // Should now allow 2 more failures before opening again
      await expect(cbShort.execute(failFn)).rejects.toThrow('fail');
      expect(cbShort.getState()).toBe('closed');

      await expect(cbShort.execute(failFn)).rejects.toThrow('fail');
      expect(cbShort.getState()).toBe('open');
    });
  });

  describe('Reset functionality', () => {
    it('should reset circuit to CLOSED state', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Trigger OPEN state
      await expect(cb.execute(fn)).rejects.toThrow('fail');
      await expect(cb.execute(fn)).rejects.toThrow('fail');
      await expect(cb.execute(fn)).rejects.toThrow('fail');
      expect(cb.getState()).toBe('open');

      // Reset
      cb.reset();
      expect(cb.getState()).toBe('closed');

      // Should now allow requests
      const successFn = vi.fn().mockResolvedValue('success');
      await cb.execute(successFn);
      expect(successFn).toHaveBeenCalled();
    });
  });

  describe('Error propagation', () => {
    it('should propagate errors from wrapped function', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('specific error'));

      await expect(cb.execute(fn)).rejects.toThrow('specific error');
    });

    it('should propagate custom error types', async () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }

      const fn = vi.fn().mockRejectedValue(new CustomError('custom error'));

      await expect(cb.execute(fn)).rejects.toBeInstanceOf(CustomError);
    });
  });
});
