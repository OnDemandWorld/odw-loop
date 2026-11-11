/**
 * Regression — abortable control.delay (deep-review fix).
 *
 * DelayNode.delay previously ignored the execution AbortSignal, so cancelling
 * an execution (or a workflow timeout) could not interrupt a long delay — the
 * node ran to completion and cancellation only took effect afterwards. The
 * delay now rejects promptly when the signal aborts, and clears its timer.
 */

import { describe, it, expect } from 'vitest';
import { DelayNode } from '../../../packages/engine/src/nodes/index';

describe('DelayNode.delay abortability', () => {
  it('resolves after the requested duration with no signal', async () => {
    const start = Date.now();
    await DelayNode.delay(30);
    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const start = Date.now();
    await expect(DelayNode.delay(5000, controller.signal)).rejects.toThrow('Delay aborted');
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('rejects promptly when aborted mid-delay (does not wait out the timer)', async () => {
    const controller = new AbortController();
    const start = Date.now();
    const pending = DelayNode.delay(5000, controller.signal);
    setTimeout(() => controller.abort(), 25);
    await expect(pending).rejects.toThrow('Delay aborted');
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('a normal completion does not leave the abort listener rejecting later', async () => {
    const controller = new AbortController();
    await DelayNode.delay(20, controller.signal);
    // Aborting after completion must not produce an unhandled rejection.
    controller.abort();
    await new Promise((r) => setTimeout(r, 30));
    expect(true).toBe(true);
  });
});