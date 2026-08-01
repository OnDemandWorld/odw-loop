/**
 * Unit tests — V1.5 M1 (F-3) distributed tracing, Loop side.
 *
 * TR1: the trace middleware reads/generates X-Trace-Id and runs the request
 *      lifecycle inside a correlation context carrying trace_id; the pino mixin
 *      stamps trace_id/request_id onto structured logs while a context is active.
 */

import { describe, it, expect } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { traceIdHook } from '../../../apps/api/src/middleware/traceId';
import { correlationMixin } from '../../../packages/observability/src/logger';
import {
  runWithCorrelation,
  getCorrelationContext,
} from '../../../packages/observability/src/correlation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mockRequest(headers: Record<string, string> = {}, extra: Record<string, unknown> = {}): FastifyRequest {
  return { headers, ...extra } as unknown as FastifyRequest;
}

const reply = {} as FastifyReply;

describe('traceIdHook (TR1)', () => {
  it('reuses the inbound X-Trace-Id header when present', () => {
    const request = mockRequest({ 'x-trace-id': 'trace-abc-123' }, { requestId: 'req-1' });
    let seen: ReturnType<typeof getCorrelationContext>;
    traceIdHook(request, reply, () => {
      seen = getCorrelationContext();
    });

    expect((request as unknown as Record<string, unknown>)['traceId']).toBe('trace-abc-123');
    expect(seen!).toEqual({ request_id: 'req-1', trace_id: 'trace-abc-123' });
  });

  it('generates a UUIDv4 trace_id when no header is supplied', () => {
    const request = mockRequest({}, { requestId: 'req-2' });
    let seen: ReturnType<typeof getCorrelationContext>;
    traceIdHook(request, reply, () => {
      seen = getCorrelationContext();
    });

    const traceId = (request as unknown as Record<string, unknown>)['traceId'] as string;
    expect(traceId).toMatch(UUID_RE);
    expect(seen!).toEqual({ request_id: 'req-2', trace_id: traceId });
  });

  it('falls back to the trace_id as request_id when neither request nor header provides one', () => {
    const request = mockRequest({});
    let seen: ReturnType<typeof getCorrelationContext>;
    traceIdHook(request, reply, () => {
      seen = getCorrelationContext();
    });

    const traceId = (request as unknown as Record<string, unknown>)['traceId'] as string;
    expect(seen!.request_id).toBe(traceId);
    expect(seen!.trace_id).toBe(traceId);
  });
});

describe('correlationMixin (TR1 — structured log injection)', () => {
  it('adds nothing when no correlation context is active', () => {
    expect(correlationMixin()).toEqual({});
  });

  it('injects trace_id and request_id while a context is active', () => {
    const fields = runWithCorrelation({ request_id: 'req-9', trace_id: 'trace-9' }, () => correlationMixin());
    expect(fields).toEqual({ trace_id: 'trace-9', request_id: 'req-9' });
  });

  it('omits trace_id when the context has none', () => {
    const fields = runWithCorrelation({ request_id: 'req-10' }, () => correlationMixin());
    expect(fields).toEqual({ request_id: 'req-10' });
  });
});
