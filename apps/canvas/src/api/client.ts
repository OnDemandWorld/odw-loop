/**
 * Loop Canvas real-time execution stream client (V1.1 M2, F5).
 *
 * REST lives in `lib/api.ts` (the single live client — the divergent parallel
 * REST client here was removed, audit #96). This module provides the WS
 * helpers: a URL builder carrying a single-use ticket (audit #23 — browsers
 * cannot set headers on a WS upgrade) and an `openExecutionSocket` wrapper
 * that parses server events.
 */

import type { Execution, NodeExecution } from '../lib/api';

// ─── Real-time execution stream (F5) ─────────────────────────────────────────

/** Node row embedded in a `snapshot` message. */
export interface SnapshotNode {
  nodeId: string;
  nodeType: string;
  status: NodeExecution['status'];
  output: Record<string, unknown>;
  error: string | null;
}

/**
 * A message pushed on `WS /ws/executions/:id`. Mirrors the engine's
 * `ExecutionBusEvent` (camelCase) plus the route's initial `snapshot`.
 */
export interface ExecutionStreamEvent {
  type:
    | 'snapshot'
    | 'execution_started'
    | 'execution_succeeded'
    | 'execution_failed'
    | 'node_started'
    | 'node_succeeded'
    | 'node_failed'
    | 'node_skipped';
  executionId?: string;
  nodeId?: string;
  nodeType?: string;
  status?: NodeExecution['status'] | Execution['status'];
  timestamp?: string;
  output?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
  /** Present only on `snapshot`. */
  nodes?: SnapshotNode[];
}

/** Build the WS URL for an execution. Audit #23: only a single-use,
 *  short-lived ticket (obtained over authenticated REST) travels in the URL —
 *  never the long-lived JWT, which would leak into access logs. */
export function buildExecutionWsUrl(executionId: string, ticket?: string | null): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${protocol}//${window.location.host}/ws/executions/${executionId}`;
  return ticket ? `${base}?ticket=${encodeURIComponent(ticket)}` : base;
}

export type SocketStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface ExecutionSocketOptions {
  ticket?: string | null;
  onStatus?: (status: SocketStatus) => void;
}

export interface ExecutionSocketHandle {
  close: () => void;
}

/**
 * Open a WebSocket to an execution's stream, parsing each message and invoking
 * `onEvent`. Returns a handle to close the socket (idempotent). Malformed
 * messages are ignored so a single bad frame cannot tear down the monitor.
 */
export function openExecutionSocket(
  executionId: string,
  onEvent: (event: ExecutionStreamEvent) => void,
  options: ExecutionSocketOptions = {},
): ExecutionSocketHandle {
  const ws = new WebSocket(buildExecutionWsUrl(executionId, options.ticket ?? null));

  ws.onopen = () => options.onStatus?.('open');
  ws.onmessage = (ev: MessageEvent) => {
    try {
      onEvent(JSON.parse(String(ev.data)) as ExecutionStreamEvent);
    } catch {
      /* ignore malformed frame */
    }
  };
  ws.onerror = () => options.onStatus?.('error');
  ws.onclose = () => options.onStatus?.('closed');

  return { close: () => ws.close() };
}
