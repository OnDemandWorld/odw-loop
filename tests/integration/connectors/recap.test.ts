/**
 * Integration tests — Recap connector (real adapter against a mock upstream).
 *
 * Exercises the real RecapAdapter's operation → endpoint mapping and JWT auth
 * against an in-process HTTP server mimicking the Recap team-server API
 * (INTEGRATION_CONTRACT.md §3).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { RecapAdapter } from '../../../packages/connectors/src/recap/adapter.js';
import { startMockServer, type MockServer } from './_mock-server.js';

describe('Recap connector integration', () => {
  let server: MockServer;
  let adapter: RecapAdapter;
  let config: Record<string, unknown>;

  beforeAll(async () => {
    server = await startMockServer();
    adapter = new RecapAdapter();
    config = { base_url: server.baseUrl, api_key: 'jwt-token-123' };
  });

  beforeEach(() => {
    server.requests.length = 0;
    server.setHandler(() => ({ body: { ok: true } }));
  });

  afterAll(async () => {
    await server.close();
  });

  it('login → POST /auth/login and returns the token', async () => {
    server.setHandler(() => ({ body: { token: 'fresh-jwt', user: { id: 'u1' } } }));

    const result = await adapter.execute({
      operation: 'login',
      input: { email: 'a@b.com', password: 'pw' },
      config: { base_url: server.baseUrl },
    });

    const req = server.requests[0];
    expect(req?.method).toBe('POST');
    expect(req?.url).toBe('/auth/login');
    expect(JSON.parse(req?.body ?? '{}')).toMatchObject({ email: 'a@b.com', password: 'pw' });
    // No Bearer header on login.
    expect(req?.headers['authorization']).toBeUndefined();
    expect(result.output['token']).toBe('fresh-jwt');
  });

  it('list_meetings → GET /meetings/ with Bearer JWT', async () => {
    server.setHandler(() => ({ body: { meetings: [{ id: 'm1', title: 'Standup' }] } }));

    const result = await adapter.execute({ operation: 'list_meetings', input: {}, config });

    const req = server.requests[0];
    expect(req?.method).toBe('GET');
    expect(req?.url).toBe('/meetings/');
    expect(req?.headers['authorization']).toBe('Bearer jwt-token-123');
    expect(result.output['meetings']).toHaveLength(1);
  });

  it('get_meeting → GET /meetings/{id}', async () => {
    server.setHandler(() => ({ body: { id: 'm7', title: 'Planning' } }));

    const result = await adapter.execute({ operation: 'get_meeting', input: { id: 'm7' }, config });

    expect(server.requests[0]?.url).toBe('/meetings/m7');
    expect(result.output['id']).toBe('m7');
  });

  it('create_meeting → POST /meetings/', async () => {
    server.setHandler(() => ({ body: { id: 'm-new', status: 'pending' } }));

    const result = await adapter.execute({
      operation: 'create_meeting',
      input: { title: 'Retro', meeting_type: 'internal', language: 'en' },
      config,
    });

    const req = server.requests[0];
    expect(req?.method).toBe('POST');
    expect(req?.url).toBe('/meetings/');
    expect(JSON.parse(req?.body ?? '{}')).toMatchObject({ title: 'Retro' });
    expect(result.output['status']).toBe('pending');
  });

  it('sync → POST /sync', async () => {
    server.setHandler(() => ({ body: { status: 'queued', meeting_id: 'm1', message: 'ok' } }));

    const result = await adapter.execute({
      operation: 'sync',
      input: { meeting_id: 'm1', action: 'push_summary', summary_data: { summary: 's' } },
      config,
    });

    const req = server.requests[0];
    expect(req?.method).toBe('POST');
    expect(req?.url).toBe('/sync');
    expect(JSON.parse(req?.body ?? '{}')).toMatchObject({ meeting_id: 'm1', action: 'push_summary' });
    expect(result.output['status']).toBe('queued');
  });

  it('prefers an input token over the configured api_key', async () => {
    server.setHandler(() => ({ body: { meetings: [] } }));

    await adapter.execute({ operation: 'list_meetings', input: { token: 'override-jwt' }, config });

    expect(server.requests[0]?.headers['authorization']).toBe('Bearer override-jwt');
  });

  it('throws UpstreamError on non-2xx responses', async () => {
    server.setHandler(() => ({ status: 401, body: { detail: 'unauthorized' } }));

    await expect(
      adapter.execute({ operation: 'list_meetings', input: {}, config }),
    ).rejects.toThrow(/Recap returned 401/);
  });

  it('healthCheck returns true on 200 and false otherwise', async () => {
    server.setHandler(() => ({ body: { status: 'ok', service: 'recap-team-server' } }));
    expect(await adapter.healthCheck(server.baseUrl)).toBe(true);

    server.setHandler(() => ({ status: 500, body: {} }));
    expect(await adapter.healthCheck(server.baseUrl)).toBe(false);
  });

  it('advertises the real Recap node types', () => {
    const caps = adapter.getCapabilities();
    expect(caps.node_types).toEqual(
      expect.arrayContaining([
        'recap.login',
        'recap.list_meetings',
        'recap.get_meeting',
        'recap.create_meeting',
        'recap.sync',
      ]),
    );
    expect(caps.node_types).not.toContain('recap.summarize');
  });
});
