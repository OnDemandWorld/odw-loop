import type { ConnectorCapabilities } from '@loop/types';

export interface ExecuteParams {
  operation: string;
  input: Record<string, unknown>;
  /** Resolved secrets for this connector instance. */
  secrets?: Record<string, string>;
  /** Connector instance configuration. */
  config?: Record<string, unknown>;
  /**
   * V1.1 M1 (F2 idempotency): stable key (`${execution_id}:${node_id}`) the
   * connector MAY forward upstream (e.g. an `Idempotency-Key` header) on a
   * best-effort basis. Optional — omitting it preserves V1.0 behaviour and the
   * outward request/response contract is unchanged.
   */
  idempotencyKey?: string;
  /**
   * Egress policy gate. When present, the adapter MUST await `check(url)` for
   * every outbound URL before dispatching — this is the enforcement point that
   * makes airgap mode and egress policies real (previously unwired: SSRF).
   */
  egress?: { check(url: string): Promise<void> };
  /**
   * Abort signal from the executor (node/workflow timeout). Adapters should
   * forward it to their HTTP client so a timed-out node stops making network
   * calls instead of continuing its side effects in the background.
   */
  signal?: AbortSignal;
}

export interface ExecuteResult {
  output: Record<string, unknown>;
}

/** Every connector implements this interface (§2.2, §9). */
export interface ConnectorAdapter {
  /** Machine-readable type identifier (e.g. 'vault', 'desk'). */
  readonly type: string;

  /** Execute an operation on this connector. */
  execute(params: ExecuteParams): Promise<ExecuteResult>;

  /** Check if the connector is reachable and healthy. Base URL defaults to the
   *  adapter's default when omitted. Audit #113: callers may pass an
   *  AbortSignal so a timed-out probe is actually cancelled. */
  healthCheck(baseUrl?: string, signal?: AbortSignal): Promise<boolean>;

  /** Discover what node types this connector provides. */
  getCapabilities(): ConnectorCapabilities;
}
