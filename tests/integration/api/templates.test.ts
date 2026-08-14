/**
 * Integration tests — templates marketplace API (/api/v1/templates).
 *
 * Spins up the real Fastify app (in-memory SQLite + the repository template
 * registry) and exercises list / detail / instantiate through fastify.inject.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, SYSTEM_USER_ID, type TestApp } from '../_helpers/app.js';

describe('Templates marketplace API (/api/v1/templates)', () => {
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

  // ── GET /api/v1/templates ────────────────────────────────────────────────

  it('lists template summaries with facet metadata', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/templates' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    // Summaries must exclude the heavy definition payload.
    for (const t of body.data) {
      expect(t).not.toHaveProperty('definition');
      expect(t.id).toBeDefined();
      expect(t.industry).toBeDefined();
      expect(t.category).toBeDefined();
    }
    // Facet vocabularies ride along in meta.
    expect(body.meta.industries).toContain('finance');
    expect(body.meta.categories).toContain('approval');
  });

  it('filters by industry', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/templates?industry=finance' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    for (const t of body.data) expect(t.industry).toBe('finance');
  });

  it('filters by featured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/templates?featured=true' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    for (const t of body.data) expect(t.featured).toBe(true);
  });

  it('filters by search substring', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/templates?search=invoice' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    for (const t of body.data) {
      expect(
        [t.id, t.name, t.description, ...t.tags, ...t.use_cases].join(' ').toLowerCase(),
      ).toContain('invoice');
    }
  });

  // ── GET /api/v1/templates/:id ────────────────────────────────────────────

  it('returns the full template with a valid definition', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/templates/invoice-approval' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('invoice-approval');
    expect(body.data.definition).toBeDefined();
    expect(Array.isArray(body.data.definition.nodes)).toBe(true);
    expect(body.data.definition.nodes.length).toBeGreaterThan(0);
  });

  it('404s with NOT_FOUND_TEMPLATE for unknown ids', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/templates/does-not-exist' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND_TEMPLATE');
  });

  // ── POST /api/v1/templates/:id/instantiate ───────────────────────────────

  it('instantiates a template into a draft workflow with provenance tag', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/templates/invoice-approval/instantiate',
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
    expect(body.data.status).toBe('draft');
    expect(body.data.created_by).toBe(SYSTEM_USER_ID);
    expect(body.data.tags).toContain('template:invoice-approval');
    // The definition is a copy of the template's graph.
    expect(body.data.definition.nodes.length).toBeGreaterThan(0);
    expect(body.meta.template_id).toBe('invoice-approval');
  });

  it('instantiates with name and description overrides', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/templates/invoice-approval/instantiate',
      payload: { name: 'ACME invoice flow', description: 'Customized for ACME' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.name).toBe('ACME invoice flow');
    expect(body.data.description).toBe('Customized for ACME');
    expect(body.data.definition.metadata.name).toBe('ACME invoice flow');
  });

  it('404s when instantiating an unknown template', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/templates/does-not-exist/instantiate',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND_TEMPLATE');
  });

  it('400s on invalid override payloads', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/templates/invoice-approval/instantiate',
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});
