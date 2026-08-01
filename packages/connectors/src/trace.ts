/**
 * V1.5 M1 (F-3, TR2): best-effort outbound distributed-trace propagation for
 * connector adapters.
 *
 * `traceHeaders()` returns an `x-trace-id` header carrying the current request's
 * trace_id when a correlation context is active (i.e. the connector runs inside a
 * traced Loop request via `runWithCorrelation`), or an empty object otherwise.
 * Adapters spread it into their outbound HTTP requests so Vault/Desk/Recap can
 * correlate their own logs against the originating Loop request.
 *
 * This adds ONLY a header — the request/response contract is unchanged
 * (INTEGRATION_CONTRACT.md §4), exactly like the existing best-effort
 * `idempotency-key` header.
 */

import { getCorrelationContext } from '@loop/observability';

export function traceHeaders(): Record<string, string> {
  const traceId = getCorrelationContext()?.trace_id;
  return traceId !== undefined ? { 'x-trace-id': traceId } : {};
}
