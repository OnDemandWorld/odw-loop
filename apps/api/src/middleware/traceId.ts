/**
 * Trace ID hook — V1.5 M1 (F-3, TR1) distributed tracing entry point.
 *
 * Reads the inbound `X-Trace-Id` header (generating a UUIDv4 when absent),
 * attaches it to the request, and runs the remainder of the request lifecycle
 * inside a correlation context carrying `trace_id`. Downstream code reads it via
 * `getCorrelationContext()`; the pino mixin (`correlationMixin`) stamps it onto
 * every structured log line, and the connector adapters forward it outbound as
 * `X-Trace-Id` (TR2). Best-effort: it never alters the business response.
 *
 * Runs AFTER `requestIdHook`, so the request_id it attached is reused here to
 * keep a single coherent correlation context for the whole request.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { runWithCorrelation } from '@loop/observability';

export function traceIdHook(request: FastifyRequest, _reply: FastifyReply, done: () => void): void {
  const traceId = (request.headers['x-trace-id'] as string | undefined) ?? randomUUID();
  const requestId =
    ((request as unknown as Record<string, unknown>)['requestId'] as string | undefined) ??
    (request.headers['x-request-id'] as string | undefined) ??
    traceId;

  // Expose on the request for handlers that prefer reading it directly.
  (request as unknown as Record<string, unknown>)['traceId'] = traceId;
  (request as unknown as Record<string, unknown>)['correlationContext'] = { request_id: requestId, trace_id: traceId };

  // Run the rest of the lifecycle within the correlation context so handlers,
  // the structured-log mixin, and connector outbound calls share this trace_id.
  runWithCorrelation({ request_id: requestId, trace_id: traceId }, done);
}
