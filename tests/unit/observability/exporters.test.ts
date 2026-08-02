/**
 * V1.6 M1 (F-2, SP2): span exporters.
 *
 *  - ConsoleSpanExporter: structured sink output; a broken sink never throws.
 *  - OtlpHttpSpanExporter: POSTs OTLP JSON to `<endpoint>/v1/traces`;
 *    unreachable/failing collectors degrade silently (no throw, no reject).
 *  - toOtlpJson: OTLP/HTTP JSON encoding (ids, timestamps, attrs, status).
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, it, expect } from 'vitest';

import {
  ConsoleSpanExporter,
  OtlpHttpSpanExporter,
  toOtlpJson,
  type SpanData,
} from '../../../packages/observability/src/index.js';

function makeSpan(overrides: Partial<SpanData> = {}): SpanData {
  return {
    name: 'test.span',
    trace_id: '0af7651916cd43dd8448eb211c80319c',
    span_id: 'b7ad6b7169203331',
    start_ms: 1_700_000_000_000,
    duration_ms: 12,
    status: 'ok',
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('ConsoleSpanExporter', () => {
  it('writes each finished span to the sink', () => {
    const seen: SpanData[] = [];
    const exporter = new ConsoleSpanExporter({ sink: (span) => seen.push(span) });

    exporter.export(makeSpan({ name: 'one' }));
    exporter.export(makeSpan({ name: 'two' }));

    expect(seen.map((s) => s.name)).toEqual(['one', 'two']);
  });

  it('a throwing sink never surfaces to the caller', () => {
    const exporter = new ConsoleSpanExporter({
      sink: () => {
        throw new Error('sink broken');
      },
    });
    expect(() => exporter.export(makeSpan())).not.toThrow();
  });

  it('default sink (structured log) does not throw', () => {
    const exporter = new ConsoleSpanExporter();
    expect(() => exporter.export(makeSpan())).not.toThrow();
  });
});

describe('OtlpHttpSpanExporter', () => {
  it('POSTs OTLP JSON to <endpoint>/v1/traces', async () => {
    const received: { url?: string; method?: string; contentType?: string; body?: string } = {};
    const server: Server = createServer((req, res) => {
      let data = '';
      req.on('data', (chunk: Buffer) => {
        data += chunk.toString('utf8');
      });
      req.on('end', () => {
        received.url = req.url;
        received.method = req.method;
        received.contentType = req.headers['content-type'];
        received.body = data;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (server.address() as AddressInfo).port;

    try {
      const exporter = new OtlpHttpSpanExporter({ endpoint: `http://127.0.0.1:${port}` });
      exporter.export(makeSpan({ name: 'otlp.span', attrs: { 'k': 'v', 'n': 3 } }));

      await waitFor(() => received.body !== undefined);
      expect(received.method).toBe('POST');
      expect(received.url).toBe('/v1/traces');
      expect(received.contentType).toBe('application/json');

      const payload = JSON.parse(received.body ?? '{}') as {
        resourceSpans: Array<{
          scopeSpans: Array<{
            spans: Array<{
              name: string;
              traceId: string;
              spanId: string;
              attributes: Array<{ key: string; value: Record<string, unknown> }>;
            }>;
          }>;
        }>;
      };
      const span = payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
      expect(span?.name).toBe('otlp.span');
      expect(span?.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
      expect(span?.spanId).toBe('b7ad6b7169203331');
      const attrs = Object.fromEntries(
        (span?.attributes ?? []).map((a) => [a.key, a.value]),
      );
      expect(attrs['k']).toEqual({ stringValue: 'v' });
      expect(attrs['n']).toEqual({ intValue: '3' });
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it('degrades silently when the collector rejects the request', async () => {
    let fetchCalls = 0;
    const failingFetch: typeof fetch = () => {
      fetchCalls += 1;
      return Promise.reject(new Error('ECONNREFUSED'));
    };

    const exporter = new OtlpHttpSpanExporter({
      endpoint: 'http://127.0.0.1:1',
      fetchImpl: failingFetch,
    });

    expect(() => exporter.export(makeSpan())).not.toThrow();
    await waitFor(() => fetchCalls > 0);
    // Let the swallowed rejection settle — no unhandled rejection, no throw.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchCalls).toBe(1);
  });

  it('degrades silently on non-2xx responses', async () => {
    const server: Server = createServer((_req, res) => {
      res.writeHead(500);
      res.end('boom');
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (server.address() as AddressInfo).port;

    try {
      const exporter = new OtlpHttpSpanExporter({ endpoint: `http://127.0.0.1:${port}` });
      expect(() => exporter.export(makeSpan())).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it('strips trailing slashes from the endpoint', () => {
    // Indirectly verified via the URL the fetch receives.
    const urls: string[] = [];
    const spyFetch: typeof fetch = (input) => {
      urls.push(String(input));
      return Promise.reject(new Error('unused'));
    };
    const exporter = new OtlpHttpSpanExporter({
      endpoint: 'http://collector.test:4318///',
      fetchImpl: spyFetch,
    });
    exporter.export(makeSpan());
    expect(urls[0]).toBe('http://collector.test:4318/v1/traces');
  });
});

describe('toOtlpJson encoding', () => {
  it('encodes timestamps as unix nanos and maps status', () => {
    const payload = toOtlpJson(makeSpan()) as {
      resourceSpans: Array<{
        scopeSpans: Array<{
          spans: Array<{
            startTimeUnixNano: string;
            endTimeUnixNano: string;
            status: { code: number };
            parentSpanId?: string;
            kind: number;
          }>;
        }>;
      }>;
    };
    const span = payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span?.startTimeUnixNano).toBe(String(1_700_000_000_000n * 1_000_000n));
    expect(span?.endTimeUnixNano).toBe(String(1_700_000_000_012n * 1_000_000n));
    expect(span?.status.code).toBe(1); // STATUS_CODE_OK
    expect(span?.parentSpanId).toBeUndefined();
  });

  it('marks error spans with OTLP status code 2 and carries parentSpanId', () => {
    const payload = toOtlpJson(
      makeSpan({ status: 'error', parent_span_id: 'aaaaaaaaaaaaaaaa' }),
    ) as {
      resourceSpans: Array<{
        scopeSpans: Array<{ spans: Array<{ status: { code: number }; parentSpanId?: string }> }>;
      }>;
    };
    const span = payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span?.status.code).toBe(2); // STATUS_CODE_ERROR
    expect(span?.parentSpanId).toBe('aaaaaaaaaaaaaaaa');
  });

  it('normalises non-hex trace ids (e.g. UUIDs) to 32 hex chars', () => {
    const payload = toOtlpJson(
      makeSpan({ trace_id: '0af76519-16cd-43dd-8448-eb211c80319c' }),
    ) as {
      resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ traceId: string }> }> }>;
    };
    const span = payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span?.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
  });

  it('encodes bool attributes', () => {
    const payload = toOtlpJson(makeSpan({ attrs: { 'flag': true } })) as {
      resourceSpans: Array<{
        scopeSpans: Array<{ spans: Array<{ attributes: Array<{ key: string; value: Record<string, unknown> }> }> }>;
      }>;
    };
    const attrs = payload.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.attributes ?? [];
    expect(attrs.find((a) => a.key === 'flag')?.value).toEqual({ boolValue: true });
  });
});
