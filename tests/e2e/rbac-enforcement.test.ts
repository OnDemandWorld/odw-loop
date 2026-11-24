/**
 * E2E — RBAC enforcement over real HTTP (audit #74).
 *
 * Previously this suite asserted a test-local permission table with legacy
 * read/write/admin roles and made no requests. It now drives the production
 * guard (createAuthGuard + requiredRoleFor) with real JWTs obtained from
 * POST /api/v1/auth/login against an auth-enabled app, covering the admin
 * gates on /api/v1/secrets and /api/v1/egress/policies that had zero coverage.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp, MINIMAL_DEFINITION, type TestApp } from '../integration/_helpers/app.js';
import { hashPassword } from '../../apps/api/src/routes/auth';

describe('RBAC enforcement (E2E) — real HTTP', () => {
  let ctx: TestApp;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await buildTestApp({ LOOP_REQUIRE_AUTH: true });
    await ctx.app.ready();
    for (const [username, role] of [
      ['viewer', 'read'],
      ['editor', 'write'],
      ['admin', 'admin'],
    ] as const) {
      await ctx.store.users.create({
        id: crypto.randomUUID(),
        username,
        password_hash: await hashPassword('rbac-pass-12345'),
        email: `${username}@loop.test`,
        role,
        display_name: username,
      });
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username, password: 'rbac-pass-12345' },
      });
      expect(res.statusCode).toBe(200);
      tokens[username] = res.json().data.token;
    }
  });

  afterAll(async () => {
    await ctx.app.close();
    ctx.conn.close();
  });

  const bearer = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });

  it('viewer can read workflows but cannot manage secrets or egress policies', async () => {
    const read = await ctx.app.inject({ method: 'GET', url: '/api/v1/workflows', headers: bearer('viewer') });
    expect(read.statusCode).toBe(200);

    const secretsRead = await ctx.app.inject({ method: 'GET', url: '/api/v1/secrets', headers: bearer('viewer') });
    expect(secretsRead.statusCode).toBe(403);

    const secretsWrite = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/secrets',
      headers: bearer('viewer'),
      payload: { name: 'k', value: 'v', scope: 'global' },
    });
    expect(secretsWrite.statusCode).toBe(403);

    const egress = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/egress/policies',
      headers: bearer('viewer'),
      payload: { name: 'p', rule_type: 'allow', target_type: 'domain', target_value: 'x.test' },
    });
    expect(egress.statusCode).toBe(403);
  });

  it('editor can create workflows but cannot manage secrets', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: bearer('editor'),
      payload: { name: 'Editor WF', description: '', definition: MINIMAL_DEFINITION },
    });
    expect(create.statusCode).toBe(201);

    const secrets = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/secrets',
      headers: bearer('editor'),
      payload: { name: 'k', value: 'v', scope: 'global' },
    });
    expect(secrets.statusCode).toBe(403);
    expect(secrets.json().error.code).toBe('FORBIDDEN_INSUFFICIENT_ROLE');
  });

  it('admin can manage secrets and egress policies', async () => {
    const secret = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/secrets',
      headers: bearer('admin'),
      payload: { name: 'admin-key', value: 'v', scope: 'global' },
    });
    expect(secret.statusCode).toBe(201);

    const policy = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/egress/policies',
      headers: bearer('admin'),
      payload: { name: 'allow-x', rule_type: 'allow', target_type: 'domain', target_value: 'x.test' },
    });
    expect(policy.statusCode).toBe(201);

    const list = await ctx.app.inject({ method: 'GET', url: '/api/v1/egress/policies', headers: bearer('admin') });
    expect(list.statusCode).toBe(200);
  });

  it('unauthenticated requests to protected routes are rejected', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/workflows' });
    expect(res.statusCode).toBe(401);
  });
});
