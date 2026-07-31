/**
 * Integration tests — Desk connector (real adapter against a mock upstream).
 *
 * Exercises the real DeskAdapter's operation → endpoint mapping against an
 * in-process HTTP server mimicking the Desk agent inbox API
 * (INTEGRATION_CONTRACT.md §2).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DeskAdapter } from '../../../packages/connectors/src/desk/adapter.js';
import { startMockServer, type MockServer } from './_mock-server.js';

describe('Desk connector integration', () => {
  let server: MockServer;
  let adapter: DeskAdapter;
  let config: Record<string, unknown>;

  beforeAll(async () => {
    server = await startMockServer();
    adapter = new DeskAdapter();
    config = { base_url: server.baseUrl };
  });

  beforeEach(() => {
    server.requests.length = 0;
    server.setHandler(() => ({ body: { ok: true } }));
  });

  afterAll(async () => {
    await server.close();
  });

  it('list_conversations → GET /api/v1/agents/conversations', async () => {
    server.setHandler(() => ({ body: [{ id: 'c1' }, { id: 'c2' }] }));

    const result = await adapter.execute({ operation: 'list_conversations', input: {}, config });

    expect(server.requests[0]?.method).toBe('GET');
    expect(server.requests[0]?.url).toBe('/api/v1/agents/conversations');
    expect(result.output).toHaveLength(2);
  });

  it('get_conversation → GET /api/v1/agents/conversations/{id}', async () => {
    server.setHandler(() => ({ body: { id: 'c9', messages: [] } }));

    const result = await adapter.execute({ operation: 'get_conversation', input: { id: 'c9' }, config });

    expect(server.requests[0]?.url).toBe('/api/v1/agents/conversations/c9');
    expect(result.output['id']).toBe('c9');
  });

  it('send_response → POST .../respond with agent_id & content query params', async () => {
    server.setHandler(() => ({ body: { sent: true } }));

    await adapter.execute({
      operation: 'send_response',
      input: { id: 'c5', agent_id: 'agent-1', content: 'Hello there' },
      config,
    });

    const req = server.requests[0];
    expect(req?.method).toBe('POST');
    expect(req?.url).toContain('/api/v1/agents/conversations/c5/respond?');
    const url = new URL(req?.url ?? '', server.baseUrl);
    expect(url.searchParams.get('agent_id')).toBe('agent-1');
    expect(url.searchParams.get('content')).toBe('Hello there');
  });

  it('takeover → POST .../takeover', async () => {
    server.setHandler(() => ({ body: { taken_over: true } }));

    await adapter.execute({ operation: 'takeover', input: { id: 'c5', agent_id: 'agent-1' }, config });

    const req = server.requests[0];
    expect(req?.method).toBe('POST');
    expect(req?.url).toBe('/api/v1/agents/conversations/c5/takeover');
    expect(JSON.parse(req?.body ?? '{}')).toMatchObject({ agent_id: 'agent-1' });
  });

  it('resolve → POST .../resolve', async () => {
    server.setHandler(() => ({ body: { resolved: true } }));

    await adapter.execute({ operation: 'resolve', input: { id: 'c5' }, config });

    expect(server.requests[0]?.method).toBe('POST');
    expect(server.requests[0]?.url).toBe('/api/v1/agents/conversations/c5/resolve');
  });

  it('throws UpstreamError on non-2xx responses', async () => {
    server.setHandler(() => ({ status: 404, body: { detail: 'not found' } }));

    await expect(
      adapter.execute({ operation: 'get_conversation', input: { id: 'nope' }, config }),
    ).rejects.toThrow(/Desk returned 404/);
  });

  it('healthCheck returns true on 200 and false otherwise', async () => {
    server.setHandler(() => ({ body: { status: 'ok' } }));
    expect(await adapter.healthCheck(server.baseUrl)).toBe(true);

    server.setHandler(() => ({ status: 503, body: {} }));
    expect(await adapter.healthCheck(server.baseUrl)).toBe(false);
  });

  it('advertises the real Desk node types', () => {
    const caps = adapter.getCapabilities();
    expect(caps.node_types).toEqual(
      expect.arrayContaining([
        'desk.list_conversations',
        'desk.get_conversation',
        'desk.send_response',
        'desk.takeover',
        'desk.resolve',
      ]),
    );
    expect(caps.node_types).not.toContain('desk.create_task');
  });
});
