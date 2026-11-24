/**
 * Request ID hook — generates a unique request_id per request and sets up
 * correlation context for downstream logging (§12.4).
 *
 * Uses AsyncLocalStorage via runWithCorrelation so that any downstream code
 * can call getCorrelationContext() to retrieve the request_id.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { generateRequestId } from '@loop/observability';

export async function requestIdHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const requestId = (request.headers['x-request-id'] as string) ?? generateRequestId();

  // Attach to request for downstream handlers (routes read this for response meta)
  (request as unknown as Record<string, unknown>)['requestId'] = requestId;

  // Audit #89: the AsyncLocalStorage correlation context is established by
  // traceIdHook (which wraps Fastify's done in storage.run). The previous
  // runWithCorrelation(..., () => {}) call here ran an EMPTY callback and
  // established nothing — removed to avoid implying this hook owns the ALS
  // context. Keep traceIdHook registered for downstream correlation.
  (request as unknown as Record<string, unknown>)['correlationContext'] = { request_id: requestId };
}
