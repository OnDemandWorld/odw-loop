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

  // Rate limiting — @fastify/rate-limit raises a FastifyError with statusCode
  // 429 (code FST_RATE_LIMIT). Map it to the proper RATE_LIMIT_EXCEEDED code
  // instead of falling through to INTERNAL_ERROR.
  const rateLimited = (err.statusCode === 429 || err.code === 'FST_RATE_LIMIT');
  if (rateLimited) {
    reply.status(429).send({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded',
      },
      meta: { request_id, timestamp: new Date().toISOString() },
    });
    return;
  }

  // Unique-constraint violations surface as 409, not 500 (A2). Concurrent
  // workflow updates, duplicate secret names and duplicate trigger ids all
  // previously landed in the generic 500 branch.
  const errCode = (error as FastifyError).code ?? '';
  const constraintLike = typeof error.message === 'string'
    && (/UNIQUE constraint failed/i.test(error.message) || errCode === 'SQLITE_CONSTRAINT_UNIQUE' || errCode === '23505');
  if (constraintLike) {
    reply.status(409).send({
      success: false,
      error: { code: 'CONFLICT_DUPLICATE', message: 'Resource conflicts with an existing record (duplicate name or concurrent version update)' },
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
