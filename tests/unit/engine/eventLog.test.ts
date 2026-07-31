/**
 * Unit tests — EventLog best-effort recording (V1.1 M1, F1).
 *
 * recordEvent must write through to StateStore.events.append on the happy path
 * and must NEVER throw when the store fails — a lost event cannot break a run.
 */

import { describe, it, expect, vi } from 'vitest';
import { recordEvent } from '../../../packages/engine/src/eventLog';
import type { StateStore } from '../../../packages/state/src';

/** Build a StateStore stub whose events.append is the given impl. */
function storeWithAppend(append: StateStore['events']['append']): StateStore {
  return { events: { append, listByExecution: async () => [] } } as unknown as StateStore;
}

describe('EventLog — recordEvent (best-effort)', () => {
  it('writes an event through to the store', async () => {
    const append = vi.fn(async () => {});
    const store = storeWithAppend(append);

    await recordEvent(store, 'exec-1', 'node_succeeded', 'node_a', { duration_ms: 5 });

    expect(append).toHaveBeenCalledTimes(1);
    const arg = append.mock.calls[0]![0];
    expect(arg.execution_id).toBe('exec-1');
    expect(arg.event_type).toBe('node_succeeded');
    expect(arg.node_id).toBe('node_a');
    expect(arg.payload).toMatchObject({ duration_ms: 5 });
    expect(typeof arg.id).toBe('string');
    expect(typeof arg.created_at).toBe('number');
  });

  it('swallows store write failures (never breaks execution)', async () => {
    const append = vi.fn(async () => {
      throw new Error('disk full');
    });
    const store = storeWithAppend(append);

    // Must resolve, not reject, even though the underlying write throws.
    await expect(recordEvent(store, 'exec-1', 'execution_failed')).resolves.toBeUndefined();
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('omits node_id for execution-level events', async () => {
    const append = vi.fn(async () => {});
    const store = storeWithAppend(append);

    await recordEvent(store, 'exec-1', 'execution_started');

    expect(append.mock.calls[0]![0].node_id).toBeUndefined();
  });
});
