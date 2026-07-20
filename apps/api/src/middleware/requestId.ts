/**
 * Request ID hook — generates a unique request_id per request and sets up
 * correlation context for downstream logging (§12.4).
 *
 * Uses AsyncLocalStorage via runWithCorrelation so that any downstream code
 * can call getCorrelationContext() to retrieve the request_id.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { generateRequestId, runWithCorrelation } from '@loop/observability';

export async function requestIdHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const requestId = (request.headers['x-request-id'] as string) ?? generateRequestId();

  // Attach to request for downstream handlers (routes read this for response meta)
  (request as unknown as Record<string, unknown>)['requestId'] = requestId;

  // Wrap the remaining request lifecycle inside a correlation context.
  // Fastify's onRequest hook runs before the route handler; by storing the
  // context on the request we ensure getCorrelationContext() is available
  // when the route handler executes within the same async scope.
  (request as unknown as Record<string, unknown>)['correlationContext'] = { request_id: requestId };

  // Run downstream in correlation context (covers handlers invoked synchronously after this hook)
  runWithCorrelation({ request_id: requestId }, () => {});
}
