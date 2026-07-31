/**
 * EventBus — lightweight in-process pub/sub for real-time execution events
 * (V1.1 M2, F5).
 *
 * The executor publishes node/execution status transitions here; the API
 * layer's `GET /ws/executions/:id` WebSocket route subscribes per executionId
 * and forwards events to connected clients. This decouples the engine from any
 * transport: the engine knows nothing about WebSockets, and the WS route knows
 * nothing about how executions run.
 *
 * Subscribers are keyed by executionId so a disconnect can clean up exactly the
 * subscriptions it owns (no cross-execution leakage, no unbounded growth).
 * Delivery is synchronous and best-effort: a throwing listener is isolated so
 * it can never break the publishing executor or other subscribers.
 */

import { createLogger } from '@loop/observability';
import type { ExecutionEventType, NodeExecutionStatus, ExecutionStatus } from '@loop/types';

const logger = createLogger({ name: 'loop:engine:eventBus', component: 'engine' });

/**
 * A real-time execution event published on the bus. Mirrors the durable event
 * log's `ExecutionEventType` discriminator (V1.1 M1) but carries the fields a
 * live monitor needs (status, output, error, timing) rather than a persisted id.
 */
export interface ExecutionBusEvent {
  /** Lifecycle discriminator, e.g. `node_started` / `node_succeeded`. */
  type: ExecutionEventType;
  executionId: string;
  /** Present for node-level events; omitted for execution-level events. */
  nodeId?: string;
  nodeType?: string;
  /** Current status of the node or execution this event concerns. */
  status: NodeExecutionStatus | ExecutionStatus;
  /** ISO-8601 timestamp of when the event was emitted. */
  timestamp: string;
  /** Node output — populated on `node_succeeded`. */
  output?: Record<string, unknown>;
  /** Error message — populated on `node_failed` / `execution_failed`. */
  error?: string;
  /** Wall-clock node duration in ms — populated on `node_succeeded`. */
  durationMs?: number;
}

/** A subscriber callback invoked with each event for its executionId. */
export type ExecutionBusListener = (event: ExecutionBusEvent) => void;

/**
 * In-process publish/subscribe hub for execution events, keyed by executionId.
 * Create one per process (see the exported `executionEventBus` singleton) or
 * inject a dedicated instance for isolated testing.
 */
export class EventBus {
  private readonly subscribers = new Map<string, Set<ExecutionBusListener>>();

  /**
   * Subscribe to events for a single execution. Returns an unsubscribe
   * function that removes exactly this listener (idempotent).
   */
  subscribe(executionId: string, listener: ExecutionBusListener): () => void {
    let set = this.subscribers.get(executionId);
    if (!set) {
      set = new Set();
      this.subscribers.set(executionId, set);
    }
    set.add(listener);

    return () => {
      this.unsubscribe(executionId, listener);
    };
  }

  /** Remove a specific listener for an execution (no-op if absent). */
  unsubscribe(executionId: string, listener: ExecutionBusListener): void {
    const set = this.subscribers.get(executionId);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      // Drop the empty bucket so long-running processes don't accumulate keys.
      this.subscribers.delete(executionId);
    }
  }

  /** Remove ALL subscribers for an execution (per-execution cleanup). */
  clear(executionId: string): void {
    this.subscribers.delete(executionId);
  }

  /** Number of active subscribers for an execution (mainly for tests). */
  subscriberCount(executionId: string): number {
    return this.subscribers.get(executionId)?.size ?? 0;
  }

  /**
   * Publish an event to every subscriber registered for its executionId.
   * Synchronous and best-effort: a listener that throws is logged and isolated
   * so it cannot disrupt the publisher or the remaining listeners.
   */
  publish(event: ExecutionBusEvent): void {
    const set = this.subscribers.get(event.executionId);
    if (!set || set.size === 0) return;
    // Iterate over a snapshot so a listener that unsubscribes during delivery
    // cannot skip siblings mid-iteration.
    for (const listener of [...set]) {
      try {
        listener(event);
      } catch (err) {
        logger.warn(
          { executionId: event.executionId, type: event.type, error: String(err) },
          'EventBus listener threw — isolated and continuing',
        );
      }
    }
  }
}

/**
 * Process-wide singleton shared by the executor (publisher) and the API
 * WebSocket route (subscriber). Both import this instance so events flow
 * without explicit wiring.
 */
export const executionEventBus = new EventBus();
