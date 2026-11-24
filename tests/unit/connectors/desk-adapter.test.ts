import { describe, it, expect, afterAll } from 'vitest';
import * as http from 'node:http';
import { DeskAdapter } from '../../../packages/connectors/src/desk/adapter';

describe('DeskAdapter — takeover/resolve contract', () => {
  const seen: { url?: string; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.push({ url: req.url, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends agent_id as a query parameter for takeover (Desk API contract)', async () => {
    const port = (server.address() as { port: number }).port;
    const adapter = new DeskAdapter();
    const result = await adapter.execute({
      operation: 'takeover',
      input: { id: 'conv-1', agent_id: 'agent-9' },
      config: { base_url: `http://127.0.0.1:${port}` },
    } as never);
    expect(result.output).toEqual({ success: true });
    const last = seen[seen.length - 1];
    expect(last.url).toContain('/api/v1/agents/conversations/conv-1/takeover?');
    expect(last.url).toContain('agent_id=agent-9');
    expect(last.body).toBe(''); // body must not be required by the Desk API
  });

  it('accepts conversation_id as the id alias for resolve', async () => {
    const port = (server.address() as { port: number }).port;
    const adapter = new DeskAdapter();
    await adapter.execute({
      operation: 'resolve',
      input: { conversation_id: 'conv-2', agent_id: 'agent-9' },
      config: { base_url: `http://127.0.0.1:${port}` },
    } as never);
    const last = seen[seen.length - 1];
    expect(last.url).toContain('/api/v1/agents/conversations/conv-2/resolve?');
  });
});

describe('DeskAdapter — list_conversations status filter (audit #32)', () => {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"conversations":[]}');
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('forwards the status filter as a query parameter', async () => {
    const port = (server.address() as { port: number }).port;
    const adapter = new DeskAdapter();
    await adapter.execute({
      operation: 'list_conversations',
      input: { status: 'open' },
      config: { base_url: `http://127.0.0.1:${port}` },
    } as never);
    expect(seen[seen.length - 1]).toContain('status=open');
  });

  it('omits the filter for all', async () => {
    const port = (server.address() as { port: number }).port;
    const adapter = new DeskAdapter();
    await adapter.execute({
      operation: 'list_conversations',
      input: { status: 'all' },
      config: { base_url: `http://127.0.0.1:${port}` },
    } as never);
    expect(seen[seen.length - 1]).not.toContain('status=');
  });
});
