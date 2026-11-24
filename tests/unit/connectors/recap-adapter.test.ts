import { describe, it, expect, afterAll } from 'vitest';
import * as http from 'node:http';
import { RecapAdapter } from '../../../packages/connectors/src/recap/adapter';
import { UpstreamError } from '@loop/types';

describe('RecapAdapter — non-JSON response handling', () => {
  const server = http.createServer((_req, res) => {
    // Simulates a wrong host/port: an unrelated HTML web app answering on the
    // configured port (e.g. a default-port collision).
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!DOCTYPE html><html><body>not recap</body></html>');
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('fails loudly instead of wrapping HTML into { text } output', async () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const adapter = new RecapAdapter();
    const promise = adapter.execute({
      operation: 'list_meetings',
      input: {},
      config: { base_url: `http://127.0.0.1:${port}` },
    } as never);
    await expect(promise).rejects.toBeInstanceOf(UpstreamError);
    await expect(promise).rejects.toMatchObject({ code: 'UPSTREAM_RECAP_BAD_RESPONSE' });
  });
});

describe('RecapAdapter — meeting id encoding (audit #38)', () => {
  const urls: string[] = [];
  const captureServer = http.createServer((req, res) => {
    urls.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"id":"m1"}');
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) => captureServer.listen(0, '127.0.0.1', resolve));
  });
  afterAll(async () => {
    captureServer.closeAllConnections();
    await new Promise<void>((resolve) => captureServer.close(() => resolve()));
  });

  it('percent-encodes traversal-shaped ids instead of redirecting the request', async () => {
    const address = captureServer.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const adapter = new RecapAdapter();
    await adapter.execute({
      operation: 'get_meeting',
      input: { id: '../../sync' },
      config: { base_url: `http://127.0.0.1:${port}` },
    } as never);
    expect(urls[0]).toBe('/meetings/..%2F..%2Fsync');
  });
});

describe('RecapAdapter — credential body hygiene (audit #112)', () => {
  const bodies: string[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      bodies.push(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"id":"m1"}');
    });
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('create_meeting/sync bodies never carry the token', async () => {
    const port = (server.address() as { port: number }).port;
    const adapter = new RecapAdapter();
    await adapter.execute({
      operation: 'create_meeting',
      input: { title: 'Standup', token: 'jwt-secret-value' },
      config: { base_url: `http://127.0.0.1:${port}` },
    } as never);
    expect(bodies[0]).not.toContain('jwt-secret-value');
    expect(JSON.parse(bodies[0]!)).toEqual({ title: 'Standup' });
  });
});
