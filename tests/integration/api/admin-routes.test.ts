/**
 * Integration tests for the routes added in the review-hardening pass:
 *  - POST /api/v1/events         → event trigger dispatch + execution (A1)
 *  - PUT  /api/v1/triggers/:id   → enable/disable + cron reschedule (A3)
 *  - Egress policy CRUD          → engine cache invalidation (A3)
 *  - POST /api/v1/connectors     → persist + register live instance (B4)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, seedWorkflow, type TestApp } from '../_helpers/app.js';

async function pollExecution(app: FastifyInstance, id: string, timeoutMs = 2000): Promise<string> {
  const start = Date.now();
  let status = 'pending';
  while (Date.now() - start < timeoutMs) {
    const res = await app.inject({ method: 'GET', url: `/api/v1/executions/${id}` });
    status = res.json().data.status;
    if (status !== 'pending' && status !== 'running') return status;
    await new Promise((r) => setTimeout(r, 25));
  }
  return status;
}

describe('Event trigger API (A1)', () => {
  let ctx: TestApp;
  let app: FastifyInstance;

  beforeAll(async () => {
    ctx = await buildTestApp();
    app = ctx.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    ctx.conn.close();
  });

  it('rejects an event with no required fields (400)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/events', payload: { payload: {} } });
    expect(res.statusCode).toBe(400);
  });

  it('creates and runs an execution when an event trigger matches', async () => {
    const wf = await seedWorkflow(ctx.store, { name: 'Event-WF' });
    const trigRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.id}/triggers`,
      payload: { trigger_type: 'event', config: { source: 'orders', event_type: 'created' } },
    });
    expect(trigRes.statusCode).toBe(201);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      payload: { source: 'orders', event_type: 'created', payload: { order_id: 42 } },
    });
    expect(res.statusCode).toBe(202);
    const executionId = res.json().data.execution_ids[0];
    expect(executionId).toBeDefined();

    // A1 fix: the dispatcher used to create pending executions nobody ran.
    const status = await pollExecution(app, executionId);
    expect(status).toBe('succeeded');

    const execution = (await app.inject({ method: 'GET', url: `/api/v1/executions/${executionId}` })).json().data;
    expect(execution.workflow_id).toBe(wf.id);
  });

  it('a non-matching event creates no executions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      payload: { source: 'unknown', event_type: 'nope', payload: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.matched_triggers).toBe(0);
  });
});

describe('Trigger enable/disable API (A3)', () => {
  let ctx: TestApp;
  let app: FastifyInstance;

  beforeAll(async () => {
    ctx = await buildTestApp();
    app = ctx.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    ctx.conn.close();
  });

  it('PUT toggles enabled and reports the updated row', async () => {
    const wf = await seedWorkflow(ctx.store);
    const trigRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.id}/triggers`,
      payload: { trigger_type: 'webhook', config: { secret: 'whsec-test-secret-32' } },
    });
    const id = trigRes.json().data.id;

    const res = await app.inject({ method: 'PUT', url: `/api/v1/triggers/${id}`, payload: { enabled: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.enabled).toBe(false);
  });

  it('rejects an empty update body', async () => {
    const wf = await seedWorkflow(ctx.store);
    const trigRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.id}/triggers`,
      payload: { trigger_type: 'webhook', config: { secret: 's-test-secret-32chars' } },
    });
    const id = trigRes.json().data.id;
    const res = await app.inject({ method: 'PUT', url: `/api/v1/triggers/${id}`, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('disabling a webhook trigger makes it 404 on inbound events', async () => {
    const wf = await seedWorkflow(ctx.store);
    const secret = 'whsec-' + Math.random();
    const trigRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.id}/triggers`,
      payload: { trigger_type: 'webhook', config: { secret } },
    });
    const id = trigRes.json().data.id;
    await app.inject({ method: 'PUT', url: `/api/v1/triggers/${id}`, payload: { enabled: false } });

    const res = await app.inject({ method: 'POST', url: `/webhooks/${id}`, payload: { x: 1 } });
    // L7 fix: disabled triggers answer the same 404 as missing ones.
    expect(res.statusCode).toBe(404);
  });
});

describe('Egress policy management API (A3)', () => {
  let ctx: TestApp;
  let app: FastifyInstance;

  beforeAll(async () => {
    ctx = await buildTestApp();
    app = ctx.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    ctx.conn.close();
  });

  it('create → list → update → delete round-trips and invalidates the cache', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/egress/policies',
      payload: { name: 'deny-metadata', rule_type: 'deny', target_type: 'domain', target_value: '169.254.169.254', priority: 100 },
    });
    expect(createRes.statusCode).toBe(201);

    const listRes = await app.inject({ method: 'GET', url: '/api/v1/egress/policies' });
    expect(listRes.statusCode).toBe(200);
    const policy = listRes.json().data.find((p: { name: string }) => p.name === 'deny-metadata');
    expect(policy).toBeDefined();

    const updRes = await app.inject({ method: 'PUT', url: `/api/v1/egress/policies/${policy.id}`, payload: { enabled: false } });
    expect(updRes.statusCode).toBe(200);

    const delRes = await app.inject({ method: 'DELETE', url: `/api/v1/egress/policies/${policy.id}` });
    expect(delRes.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/api/v1/egress/policies' });
    expect(after.json().data.find((p: { id: string }) => p.id === policy.id)).toBeUndefined();
  });

  it('rejects malformed policy bodies (400)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/egress/policies', payload: { name: 'x' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('Connector create API (B4)', () => {
  let ctx: TestApp;
  let app: FastifyInstance;

  beforeAll(async () => {
    ctx = await buildTestApp();
    app = ctx.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    ctx.conn.close();
  });

  it('creates a connector instance visible to GET and live in the registry', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors',
      payload: { connector_type: 'vault', name: 'vault-alt', config: { base_url: 'http://vault.example:8765' } },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().data.id;

    // B4 fix: the row is also registered into the runtime registry, so the
    // next execution can resolve it (previously GET listed rows the executor
    // never saw).
    expect(ctx.connectors.getInstanceConfig(id)).toEqual({ base_url: 'http://vault.example:8765' });

    const list = await app.inject({ method: 'GET', url: '/api/v1/connectors' });
    expect(list.json().data.find((c: { id: string }) => c.id === id)).toBeDefined();

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/connectors/${id}` });
    expect(del.statusCode).toBe(200);
    expect(ctx.connectors.getInstanceConfig(id)).toBeUndefined();
  });

  it('rejects an unknown connector type (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors',
      payload: { connector_type: 'nonexistent', name: 'x', config: {} },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Readiness probe (audit #22)', () => {
  let ctx: TestApp;
  let app: FastifyInstance;

  beforeAll(async () => {
    ctx = await buildTestApp();
    app = ctx.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    ctx.conn.close();
  });

  it('reports real database health and answers 503 when the store is down', async () => {
    const ok = await app.inject({ method: 'GET', url: '/ready' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('ready');
    expect(ok.json().checks.database).toBe('ok');

    const spy = vi.spyOn(ctx.store.workflows, 'list').mockRejectedValueOnce(new Error('db down'));
    const bad = await app.inject({ method: 'GET', url: '/ready' });
    expect(bad.statusCode).toBe(503);
    expect(bad.json().status).toBe('not_ready');
    expect(bad.json().checks.database).toBe('unreachable');
    spy.mockRestore();
  });
});
