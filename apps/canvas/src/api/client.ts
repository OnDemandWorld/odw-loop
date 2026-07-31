/**
 * Loop Canvas API client (V1.1 M2, F4).
 *
 * A typed fetch wrapper that adds what the existing `lib/api.ts` helper does
 * not: a configurable base URL and an `Authorization: Bearer <token>` header
 * sourced from a token provider (so the SPA can talk to an auth-enforced
 * backend, V1.0 §11). Also provides the real-time WebSocket helpers used by the
 * execution monitor (V1.1 M2, F5): a URL builder that carries the token as a
 * query param (browsers cannot set headers on a WS upgrade) and a small
 * `openExecutionSocket` wrapper that parses server events.
 */

import type { Execution, NodeExecution } from '../lib/api';

// ─── REST client ─────────────────────────────────────────────────────────────

export interface ApiClientOptions {
  /** Prepended to every path. Defaults to '' (same-origin via the dev proxy). */
  baseUrl?: string;
  /** Returns the current bearer token, or null when unauthenticated. */
  getToken?: () => string | null;
}

/** Error thrown for non-2xx responses or `{ success: false }` envelopes. */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: { code: string; message: string };
}

/** Read the token persisted by the (future) login flow; null when absent. */
function defaultGetToken(): string | null {
  try {
    return window.localStorage.getItem('loop.token');
  } catch {
    return null;
  }
}

export interface ApiClient {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  put: <T>(path: string, body?: unknown) => Promise<T>;
  del: <T>(path: string) => Promise<T>;
}

/** Build a JSON REST client bound to the given base URL + token provider. */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? '';
  const getToken = options.getToken ?? defaultGetToken;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body != null && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const token = getToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    const body = (await res.json().catch(() => null)) as Envelope<T> | null;

    if (!res.ok || (body != null && body.success === false)) {
      throw new ApiClientError(
        body?.error?.code ?? `HTTP_${res.status}`,
        body?.error?.message ?? res.statusText,
        res.status,
      );
    }
    // Unwrap `{ success, data }` envelopes; pass through bare payloads.
    return (body && 'data' in body ? body.data : body) as T;
  }

  const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

  return {
    request,
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) => request<T>(path, json(body)),
    put: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
    del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  };
}

/** Default same-origin client (requests are proxied to the API in dev). */
export const apiClient = createApiClient();

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

/** Build the WS URL for an execution, carrying the token as a query param. */
export function buildExecutionWsUrl(executionId: string, token?: string | null): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${protocol}//${window.location.host}/ws/executions/${executionId}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

export type SocketStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface ExecutionSocketOptions {
  token?: string | null;
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
  const ws = new WebSocket(buildExecutionWsUrl(executionId, options.token ?? null));

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
