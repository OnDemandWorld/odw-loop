/**
 * Integration tests — HTTP auth guard (LOOP_REQUIRE_AUTH gate).
 *
 * Verifies the backward-compatible authentication on /api/v1/*:
 *   - LOOP_REQUIRE_AUTH unset/false → endpoints are open (no credentials needed).
 *   - LOOP_REQUIRE_AUTH=true → requests without a valid API key/JWT get 401.
 *   - A valid static API key (x-api-key or Bearer) or JWT → 200.
 *   - Public endpoints (/health) stay open even when auth is enforced.
 *   - The authenticated principal replaces the hardcoded 'system' created_by.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as jose from 'jose';
import { buildTestApp, type TestApp } from '../_helpers/app.js';

const API_KEY = 'super-secret-loop-api-key';

const VALID_DEFINITION = {
  version: '1.0',
  nodes: [],
  edges: [],
  variables: {},
  metadata: { name: 'auth-guard-wf' },
};

describe('API auth guard (LOOP_REQUIRE_AUTH)', () => {
  const contexts: TestApp[] = [];

  afterAll(async () => {
    for (const ctx of contexts) {
      await ctx.app.close();
      ctx.conn.close();
    }
  });

  async function buildApp(overrides: Parameters<typeof buildTestApp>[0] = {}): Promise<TestApp> {
    const ctx = await buildTestApp(overrides);
    await ctx.app.ready();
    contexts.push(ctx);
    return ctx;
  }

  // ── Backward compatibility: open by default ───────────────────────────────

  it('LOOP_REQUIRE_AUTH unset (default false) → /api/v1/* is open', async () => {
    const ctx = await buildApp();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/workflows' });
    expect(res.statusCode).toBe(200);
  });

  // ── Enforcement: 401 without credentials ──────────────────────────────────

  it('LOOP_REQUIRE_AUTH=true, no credentials → 401', async () => {
    const ctx = await buildApp({ LOOP_REQUIRE_AUTH: true, LOOP_API_KEY: API_KEY });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/workflows' });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AUTH_MISSING');
  });

  it('LOOP_REQUIRE_AUTH=true, invalid API key → 401', async () => {
    const ctx = await buildApp({ LOOP_REQUIRE_AUTH: true, LOOP_API_KEY: API_KEY });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/workflows',
      headers: { 'x-api-key': 'wrong-key' },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Valid credentials: 200 ────────────────────────────────────────────────

  it('LOOP_REQUIRE_AUTH=true, valid x-api-key → 200', async () => {
    const ctx = await buildApp({ LOOP_REQUIRE_AUTH: true, LOOP_API_KEY: API_KEY });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/workflows',
      headers: { 'x-api-key': API_KEY },
    });
    expect(res.statusCode).toBe(200);
  });

  it('LOOP_REQUIRE_AUTH=true, valid Bearer API key → 200', async () => {
    const ctx = await buildApp({ LOOP_REQUIRE_AUTH: true, LOOP_API_KEY: API_KEY });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/workflows',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('LOOP_REQUIRE_AUTH=true, valid JWT bearer → 200', async () => {
    const ctx = await buildApp({ LOOP_REQUIRE_AUTH: true, LOOP_API_KEY: API_KEY });
    const secret = new TextEncoder().encode(ctx.config.LOOP_JWT_SECRET);
    const token = await new jose.SignJWT({ sub: 'system', role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('15m')
      .setIssuedAt()
      .sign(secret);

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/workflows',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // ── Public endpoints stay open ────────────────────────────────────────────

  it('LOOP_REQUIRE_AUTH=true, /health remains public → 200', async () => {
    const ctx = await buildApp({ LOOP_REQUIRE_AUTH: true, LOOP_API_KEY: API_KEY });
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  // ── Authenticated principal replaces hardcoded created_by ─────────────────

  it('JWT principal is used as created_by on workflow create', async () => {
    const ctx = await buildApp({ LOOP_REQUIRE_AUTH: true, LOOP_API_KEY: API_KEY });

    const userId = crypto.randomUUID();
    await ctx.store.users.create({
      id: userId,
      username: 'author',
      password_hash: 'x',
      email: 'author@loop.test',
      role: 'admin',
    });

    const secret = new TextEncoder().encode(ctx.config.LOOP_JWT_SECRET);
    const token = await new jose.SignJWT({ sub: userId, role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('15m')
      .setIssuedAt()
      .sign(secret);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Authored Workflow', definition: VALID_DEFINITION },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.created_by).toBe(userId);
  });
});
