/**
 * Global error handler — converts errors to standard API envelope (§12.1).
 */

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { LoopError } from '@loop/types';
import { getCorrelationContext } from '@loop/observability';
import { createLogger } from '@loop/observability';

const logger = createLogger({ name: 'loop:api:errorHandler', component: 'api' });

export function errorHandler(error: FastifyError | LoopError | Error, request: FastifyRequest, reply: FastifyReply): void {
  const ctx = getCorrelationContext();
  const request_id = ctx?.request_id ?? 'unknown';

  if (error instanceof LoopError) {
    logger.warn({ code: error.code, statusCode: error.statusCode, message: error.message }, 'Loop error');
    reply.status(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
      meta: {
        request_id,
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  // Fastify validation errors (Zod / JSON schema)
  const err = error as FastifyError;
  if (err.validation) {
    reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.validation,
      },
      meta: { request_id, timestamp: new Date().toISOString() },
    });
    return;
  }

  // Unexpected errors
  logger.error({ error: String(error), stack: error.stack }, 'Unhandled error');
  reply.status((error as FastifyError).statusCode ?? 500).send({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env['LOOP_ENV'] === 'production' ? 'Internal server error' : error.message,
    },
    meta: { request_id, timestamp: new Date().toISOString() },
  });
}
