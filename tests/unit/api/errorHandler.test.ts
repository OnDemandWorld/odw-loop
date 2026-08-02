import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../../apps/api/src/middleware/errorHandler.js';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/**
 * V1.6 load-test regression: @fastify/rate-limit raises a FastifyError with
 * statusCode 429 (code FST_RATE_LIMIT). The handler must map it to the proper
 * RATE_LIMIT_EXCEEDED envelope code, not INTERNAL_ERROR.
 */
function mockReply() {
  const reply = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return reply as unknown as FastifyReply & { statusCode: number; body: any };
}

const mockRequest = {} as FastifyRequest;

function fastifyError(statusCode: number, code?: string, message = 'Rate limit exceeded'): FastifyError {
  const err = new Error(message) as FastifyError;
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

describe('errorHandler rate-limit mapping', () => {
  it('maps statusCode 429 to RATE_LIMIT_EXCEEDED', () => {
    const reply = mockReply();
    errorHandler(fastifyError(429), mockRequest, reply);
    expect(reply.statusCode).toBe(429);
    expect((reply.body as any).success).toBe(false);
    expect((reply.body as any).error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('maps code FST_RATE_LIMIT to RATE_LIMIT_EXCEEDED', () => {
    const reply = mockReply();
    errorHandler(fastifyError(429, 'FST_RATE_LIMIT'), mockRequest, reply);
    expect(reply.statusCode).toBe(429);
    expect((reply.body as any).error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('does not treat a generic 500 as rate-limited', () => {
    const reply = mockReply();
    errorHandler(fastifyError(500, undefined, 'boom'), mockRequest, reply);
    expect(reply.statusCode).toBe(500);
    expect((reply.body as any).error.code).toBe('INTERNAL_ERROR');
  });
});
