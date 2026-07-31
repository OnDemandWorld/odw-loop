/**
 * Integration tests — RBAC route guards (V1.3 M2, F-RBAC-Loop).
 *
 *  - reads (GET) need viewer+; writes (POST/PUT/DELETE) need editor+;
 *    admin routes (/api/v1/audit) need admin.
 *  - viewer write → 403; editor write → 200/201; viewer read → 200.
 *  - role resolves from JWT `role` claim and from the static API key via
 *    LOOP_API_KEY_ROLE (default admin).
 *  - BACKWARD COMPATIBLE: LOOP_REQUIRE_AUTH off → fully open (no credentials).
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as jose from 'jose';
import { buildTestApp, type TestApp } from '../_helpers/app.js';

const API_KEY = 'rbac-test-api-key';

const VALID_DEFINITION = {
  version: '1.0',
  nodes: [],
  edges: [],
  variables: {},
  metadata: { name: 'rbac-wf' },
};

describe('API RBAC (V1.3 M2)', () => {
  const contexts: TestApp[] = [];

  afterAll(async () => {
    for (const ctx of contexts) {
      await ctx.app.close();
      ctx.conn.close();
    }
  });

  async function build(overrides: Parameters<typeof buildTestApp>[0] = {}): Promise<TestApp> {
    const ctx = await buildTestApp({ LOOP_REQUIRE_AUTH: true, LOOP_API_KEY: API_KEY, ...overrides });
    await ctx.app.ready();
    contexts.push(ctx);
    return ctx;
  }

  /** Seed a user and mint a JWT carrying the given role for that principal. */
  async function tokenForRole(ctx: TestApp, role: 'admin' | 'editor' | 'viewer'): Promise<string> {
    const userId = crypto.randomUUID();
    await ctx.store.users.create({
      id: userId,
      username: `${role}-user`,
      password_hash: 'x',
      email: `${role}@loop.test`,
      role: 'admin',
    });
    const secret = new TextEncoder().encode(ctx.config.LOOP_JWT_SECRET);
    return new jose.SignJWT({ sub: userId, role })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('15m')
      .setIssuedAt()
      .sign(secret);
  }

  // ── Reads: viewer+ ────────────────────────────────────────────────────────

  it('viewer can read workflows → 200', async () => {
    const ctx = await build();
    const token = await tokenForRole(ctx, 'viewer');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/workflows',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // ── Writes: editor+ ───────────────────────────────────────────────────────

  it('viewer cannot create a workflow → 403', async () => {
    const ctx = await build();
    const token = await tokenForRole(ctx, 'viewer');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Viewer WF', definition: VALID_DEFINITION },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN_INSUFFICIENT_ROLE');
  });

  it('editor can create a workflow → 201', async () => {
    const ctx = await build();
    const token = await tokenForRole(ctx, 'editor');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Editor WF', definition: VALID_DEFINITION },
    });
    expect(res.statusCode).toBe(201);
  });

  it('viewer cannot trigger execution (write) → 403', async () => {
    const ctx = await build();
    const token = await tokenForRole(ctx, 'viewer');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${crypto.randomUUID()}/execute`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  // ── Admin routes: admin only ──────────────────────────────────────────────

  it('viewer cannot read the admin audit log → 403', async () => {
    const ctx = await build();
    const token = await tokenForRole(ctx, 'viewer');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('editor cannot read the admin audit log → 403', async () => {
    const ctx = await build();
    const token = await tokenForRole(ctx, 'editor');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin can read the audit log → 200', async () => {
    const ctx = await build();
    const token = await tokenForRole(ctx, 'admin');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // ── Static API key role mapping ───────────────────────────────────────────

  it('static API key defaults to admin → can write', async () => {
    const ctx = await build(); // LOOP_API_KEY_ROLE defaults to 'admin'
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { 'x-api-key': API_KEY },
      payload: { name: 'Key WF', definition: VALID_DEFINITION },
    });
    expect(res.statusCode).toBe(201);
  });

  it('LOOP_API_KEY_ROLE=viewer → API key write is 403, read is 200', async () => {
    const ctx = await build({ LOOP_API_KEY_ROLE: 'viewer' });
    const write = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { 'x-api-key': API_KEY },
      payload: { name: 'Key WF', definition: VALID_DEFINITION },
    });
    expect(write.statusCode).toBe(403);

    const read = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/workflows',
      headers: { 'x-api-key': API_KEY },
    });
    expect(read.statusCode).toBe(200);
  });

  // ── Backward compatibility: auth off → open ───────────────────────────────

  it('LOOP_REQUIRE_AUTH off → writes are open without any credentials', async () => {
    const ctx = await buildTestApp({ LOOP_REQUIRE_AUTH: false });
    await ctx.app.ready();
    contexts.push(ctx);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      payload: { name: 'Open WF', definition: VALID_DEFINITION },
    });
    expect(res.statusCode).toBe(201);
  });
});
