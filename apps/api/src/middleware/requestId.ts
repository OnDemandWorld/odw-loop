/**
 * Request ID hook — generates a unique request_id per request and sets up
 * correlation context for downstream logging (§12.4).
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { generateRequestId } from '@loop/observability';

export async function requestIdHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const requestId = (request.headers['x-request-id'] as string) ?? generateRequestId();

  // Attach to request for downstream handlers
  (request as unknown as Record<string, unknown>)['requestId'] = requestId;

  // Run the rest of the request lifecycle inside a correlation context
  // Note: in a real implementation this would wrap the route handler, not just the hook.
  // For now we store the context on the request object.
  (request as unknown as Record<string, unknown>)['correlationContext'] = { request_id: requestId };
}
