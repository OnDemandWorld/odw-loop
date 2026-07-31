/**
 * Unit tests — EventBus in-process pub/sub (V1.1 M2, W1).
 *
 * Verifies publish/subscribe semantics, per-execution isolation, the returned
 * unsubscribe function, per-execution cleanup, and that a throwing listener is
 * isolated so it can never break the publisher or sibling subscribers.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventBus, type ExecutionBusEvent } from '../../../packages/engine/src/eventBus';

function event(executionId: string, overrides: Partial<ExecutionBusEvent> = {}): ExecutionBusEvent {
  return {
    type: 'node_started',
    executionId,
    nodeId: 'node_a',
    nodeType: 'vault.search',
    status: 'running',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('EventBus — publish / subscribe / cleanup', () => {
  it('delivers a published event to subscribers of that execution', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.subscribe('exec-1', listener);

    const evt = event('exec-1');
    bus.publish(evt);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(evt);
  });

  it('does not deliver events across different executionIds', () => {
    const bus = new EventBus();
    const l1 = vi.fn();
    const l2 = vi.fn();
    bus.subscribe('exec-1', l1);
    bus.subscribe('exec-2', l2);

    bus.publish(event('exec-1'));

    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).not.toHaveBeenCalled();
  });

  it('supports multiple subscribers per execution', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe('exec-1', a);
    bus.subscribe('exec-1', b);

    bus.publish(event('exec-1'));

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(bus.subscriberCount('exec-1')).toBe(2);
  });

  it('returns an unsubscribe function that removes exactly that listener', () => {
    const bus = new EventBus();
    const keep = vi.fn();
    const drop = vi.fn();
    bus.subscribe('exec-1', keep);
    const unsub = bus.subscribe('exec-1', drop);

    unsub();
    bus.publish(event('exec-1'));

    expect(keep).toHaveBeenCalledTimes(1);
    expect(drop).not.toHaveBeenCalled();
    expect(bus.subscriberCount('exec-1')).toBe(1);
  });

  it('unsubscribe is idempotent and drops the empty bucket', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    const unsub = bus.subscribe('exec-1', listener);

    unsub();
    unsub(); // second call is a no-op
    expect(bus.subscriberCount('exec-1')).toBe(0);

    bus.publish(event('exec-1'));
    expect(listener).not.toHaveBeenCalled();
  });

  it('clear() removes every subscriber for an execution only', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    const other = vi.fn();
    bus.subscribe('exec-1', a);
    bus.subscribe('exec-1', b);
    bus.subscribe('exec-2', other);

    bus.clear('exec-1');

    expect(bus.subscriberCount('exec-1')).toBe(0);
    expect(bus.subscriberCount('exec-2')).toBe(1);
    bus.publish(event('exec-1'));
    bus.publish(event('exec-2'));
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing listener so siblings still receive the event', () => {
    const bus = new EventBus();
    const bad = vi.fn(() => {
      throw new Error('listener boom');
    });
    const good = vi.fn();
    bus.subscribe('exec-1', bad);
    bus.subscribe('exec-1', good);

    // Must not throw despite the bad listener.
    expect(() => bus.publish(event('exec-1'))).not.toThrow();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('publishing to an execution with no subscribers is a no-op', () => {
    const bus = new EventBus();
    expect(() => bus.publish(event('exec-ghost'))).not.toThrow();
    expect(bus.subscriberCount('exec-ghost')).toBe(0);
  });
});
