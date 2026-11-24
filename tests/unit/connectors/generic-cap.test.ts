/**
 * Unit tests — generic REST response size cap (audit #34).
 *
 * The target URL is arbitrary workflow input; an unbounded body.text() on a
 * huge export OOM-crashes the monolith. Responses above the cap must fail
 * with a clear UpstreamError; normal responses still round-trip.
 */

import * as http from 'node:http';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { GenericAdapter } from '../../../packages/connectors/src/generic/adapter';
import { UpstreamError } from '../../../packages/types/src/errors';

describe('GenericAdapter — response size cap (audit #34)', () => {
  const bigBody = 'x'.repeat(11 * 1024 * 1024); // 11 MB > 10 MB cap
  const seenHeaders: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    seenHeaders.push(req.headers);
    if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(bigBody);
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    }
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function baseUrl(): string {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return `http://127.0.0.1:${port}`;
  }

  it('rejects responses above the cap with a clear UpstreamError', async () => {
    const adapter = new GenericAdapter();
    const promise = adapter.execute({
      operation: 'rest_call',
      input: { path: '/big', method: 'GET' },
      config: { base_url: baseUrl() },
    } as never);
    await expect(promise).rejects.toBeInstanceOf(UpstreamError);
    await expect(promise).rejects.toThrow(/exceeds/);
  });

  it('normal responses still round-trip', async () => {
    const adapter = new GenericAdapter();
    const result = await adapter.execute({
      operation: 'rest_call',
      input: { path: '/small', method: 'GET' },
      config: { base_url: baseUrl() },
    } as never);
    expect((result as { output: { data: unknown } }).output.data).toEqual({ ok: true });
  });
});

describe('GenericAdapter — input headers (audit #33)', () => {
  // Reuses the capture server above (same describe scope is closed; start a
  // dedicated one here to keep the suites independent).
  const seen: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('merges input.headers over config headers (canvas Headers field)', async () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const adapter = new GenericAdapter();
    await adapter.execute({
      operation: 'rest_call',
      input: { path: '/x', method: 'GET', headers: { authorization: 'Bearer input-token', 'x-custom': 'yes' } },
      config: { base_url: `http://127.0.0.1:${port}`, headers: { 'x-instance': 'kept' } },
    } as never);
    expect(seen[0]!['authorization']).toBe('Bearer input-token');
    expect(seen[0]!['x-custom']).toBe('yes');
    expect(seen[0]!['x-instance']).toBe('kept');
  });
});
