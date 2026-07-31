/**
 * EventLog — best-effort execution event recording (V1.1 M1, F1 durable recovery).
 *
 * Wraps `StateStore.events.append` so the executor and recovery can record
 * lifecycle events without ever breaking execution: a write failure is logged
 * as a warning and swallowed. The event log is an audit / resume aid, not a
 * source of truth — losing an event must never fail a workflow.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@loop/observability';
import type { StateStore } from '@loop/state';
import type { ExecutionEventType } from '@loop/types';

const logger = createLogger({ name: 'loop:engine:eventLog', component: 'engine' });

/**
 * Record an execution event on a best-effort basis.
 *
 * Never throws: any store error is caught and logged at warn level so event
 * recording cannot interrupt the surrounding execution.
 */
export async function recordEvent(
  store: StateStore,
  executionId: string,
  eventType: ExecutionEventType,
  nodeId?: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await store.events.append({
      id: randomUUID(),
      execution_id: executionId,
      event_type: eventType,
      node_id: nodeId,
      payload,
      created_at: Date.now(),
    });
  } catch (err) {
    logger.warn(
      { executionId, eventType, nodeId, error: String(err) },
      'Failed to record execution event (best-effort) — continuing',
    );
  }
}
