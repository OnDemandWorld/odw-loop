/**
 * Integration tests — workflow CRUD via HTTP (TSD §5.3).
 *
 * Spins up the real Fastify app (with in-memory SQLite) and exercises the
 * POST / GET / PUT / DELETE endpoints through `fastify.inject`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, seedWorkflow, SYSTEM_USER_ID, type TestApp } from '../_helpers/app.js';

describe('Workflow CRUD API (/api/v1/workflows)', () => {
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

  beforeEach(async () => {
    // Clean workflows between tests (ignore FK errors for related rows).
    const existing = await ctx.store.workflows.list({}, { page: 1, per_page: 100 });
    for (const wf of existing.data) {
      try { await ctx.store.workflows.delete(wf.id); } catch { /* ignore */ }
    }
  });

  // ── POST /api/v1/workflows ────────────────────────────────────────────────

  it('POST /api/v1/workflows creates a workflow and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      payload: {
        name: 'My Workflow',
        description: 'Test workflow via HTTP',
        definition: {
          version: '1.0',
          nodes: [],
          edges: [],
          variables: {},
          metadata: { name: 'http-wf' },
        },
        tags: ['integration'],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data.id).toBeDefined();
    expect(body.data.name).toBe('My Workflow');
    expect(body.data.status).toBe('draft');
    expect(body.data.created_by).toBe(SYSTEM_USER_ID);
    expect(body.meta).toBeDefined();
    expect(body.meta.timestamp).toBeDefined();
  });

  it('POST /api/v1/workflows rejects invalid topology (cycle)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      payload: {
        name: 'Cyclic Workflow',
        definition: {
          version: '1.0',
          nodes: [
            { id: 'a', type: 'vault.search', position: { x: 0, y: 0 }, config: {} },
            { id: 'b', type: 'vault.search', position: { x: 100, y: 0 }, config: {} },
          ],
          edges: [
            { id: 'e1', source: 'a', target: 'b' },
            { id: 'e2', source: 'b', target: 'a' },
          ],
        },
      },
    });

    // Validator rejects cycles → 400 (ValidationError)
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });

  // ── GET /api/v1/workflows ─────────────────────────────────────────────────

  it('GET /api/v1/workflows lists workflows with pagination metadata', async () => {
    await seedWorkflow(ctx.store, { name: 'Alpha' });
    await seedWorkflow(ctx.store, { name: 'Beta' });
    await seedWorkflow(ctx.store, { name: 'Gamma' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows?page=1&per_page=2',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.meta.total).toBe(3);
    expect(body.meta.page).toBe(1);
    expect(body.meta.per_page).toBe(2);
    expect(body.meta.total_pages).toBe(2);
  });

  it('GET /api/v1/workflows honours status filter', async () => {
    const wf = await seedWorkflow(ctx.store, { name: 'Draft One' });
    await ctx.store.workflows.update(wf.id, { status: 'active', updated_by: SYSTEM_USER_ID });
    await seedWorkflow(ctx.store, { name: 'Draft Two' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows?status=active',
    });

    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('Draft One');
  });

  // ── GET /api/v1/workflows/:id ─────────────────────────────────────────────

  it('GET /api/v1/workflows/:id returns a workflow by id', async () => {
    const wf = await seedWorkflow(ctx.store, { name: 'Get Me' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workflows/${wf.id}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(wf.id);
    expect(body.data.name).toBe('Get Me');
  });

  it('GET /api/v1/workflows/:id returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/00000000-0000-0000-0000-999999999999',
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND_WORKFLOW');
  });

  // ── PUT /api/v1/workflows/:id ─────────────────────────────────────────────

  it('PUT /api/v1/workflows/:id updates a workflow', async () => {
    const wf = await seedWorkflow(ctx.store, { name: 'Old Name' });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/workflows/${wf.id}`,
      payload: {
        name: 'New Name',
        description: 'Updated description',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.name).toBe('New Name');
    expect(body.data.description).toBe('Updated description');
  });

  it('PUT /api/v1/workflows/:id bumps version when definition changes', async () => {
    const wf = await seedWorkflow(ctx.store);
    expect(wf.version).toBe(1);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/workflows/${wf.id}`,
      payload: {
        definition: {
          version: '1.0',
          nodes: [{ id: 'n1', type: 'vault.search', position: { x: 0, y: 0 }, config: {} }],
          edges: [],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.version).toBe(2);
  });

  // ── DELETE /api/v1/workflows/:id ──────────────────────────────────────────

  it('DELETE /api/v1/workflows/:id archives the workflow', async () => {
    const wf = await seedWorkflow(ctx.store);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workflows/${wf.id}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('archived');

    // Confirm it's no longer returned as draft/active
    const list = await ctx.store.workflows.list({ status: 'draft' }, { page: 1, per_page: 10 });
    const stillThere = list.data.find((w) => w.id === wf.id);
    expect(stillThere).toBeUndefined();
  });
});
