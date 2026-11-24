/**
 * Integration tests — authentication over real HTTP (audit #76).
 *
 * Previously these tests hand-signed JWTs with jose and asserted inline
 * boolean tautologies ("canLogin = user.is_active"). They now exercise the
 * actual POST /api/v1/auth/login route and the user store operations the
 * route depends on. Guard-level RBAC coverage lives in api/rbac.test.ts and
 * the e2e rbac-enforcement suite.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp, type TestApp } from '../_helpers/app.js';
import { hashPassword } from '../../../apps/api/src/routes/auth';

describe('Authentication (HTTP)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await buildTestApp();
    await ctx.app.ready();
  });

  afterAll(async () => {
    await ctx.app.close();
    ctx.conn.close();
  });

  async function createUser(username: string, role = 'write'): Promise<string> {
    const id = crypto.randomUUID();
    await ctx.store.users.create({
      id,
      username,
      password_hash: await hashPassword('correct-horse-battery-staple'),
      email: `${username}@loop.test`,
      role,
      display_name: username,
    });
    return id;
  }

  it('login returns a token and the mapped user for valid credentials', async () => {
    await createUser('alice', 'admin');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'alice', password: 'correct-horse-battery-staple' },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(typeof data.token).toBe('string');
    expect(data.token.split('.')).toHaveLength(3);
    expect(data.user.username).toBe('alice');
    expect(data.user.role).toBe('admin');
    expect(data.expires_in).toBeGreaterThan(0);
  });

  it('wrong password is rejected with 401', async () => {
    await createUser('bob');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'bob', password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().success).toBe(false);
  });

  it('unknown user is rejected with 401', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'nobody-here', password: 'whatever-123' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('deactivated user cannot log in', async () => {
    const id = await createUser('deactivated');
    await ctx.store.users.deactivate(id);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'deactivated', password: 'correct-horse-battery-staple' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('role can be updated via users.updateRole and is reflected at login', async () => {
    const id = await createUser('promotable', 'read');
    await ctx.store.users.updateRole(id, 'admin');
    const updated = await ctx.store.users.getById(id);
    expect(updated!.role).toBe('admin');

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'promotable', password: 'correct-horse-battery-staple' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.role).toBe('admin');
  });
});
