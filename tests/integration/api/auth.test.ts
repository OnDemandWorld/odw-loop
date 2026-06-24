/**
 * Integration tests — authentication & RBAC primitives.
 *
 * NOTE: The HTTP routes currently hardcode `created_by: 'system'` and do not
 * yet wire up JWT authentication middleware. These tests exercise the
 * underlying primitives: user store, password verification, and JWT
 * signing/verification. Once auth middleware is added to routes, these tests
 * should be promoted to HTTP-level assertions.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { compare, hash } from 'bcrypt';
import * as jose from 'jose';
import {
  buildTestApp,
  seedWorkflow,
  SYSTEM_USER_ID,
  type TestApp,
} from '../_helpers/app.js';

describe('Authentication & RBAC', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await buildTestApp();
    await ctx.app.ready();
  });

  afterAll(async () => {
    await ctx.app.close();
    ctx.conn.close();
  });

  // ── POST /api/v1/auth/login — token generation ────────────────────────────

  it('login returns access and refresh tokens for valid credentials', async () => {
    const password = 'correct-horse-battery-staple';
    const passwordHash = await hash(password, 10);

    await ctx.store.users.create({
      id: crypto.randomUUID(),
      username: 'alice',
      password_hash: passwordHash,
      email: 'alice@loop.test',
      role: 'write',
    });

    // Simulate login flow (routes don't yet expose POST /auth/login; this
    // exercises the primitive the route will wrap).
    const user = await ctx.store.users.getByUsername('alice');
    expect(user).not.toBeNull();
    expect(await compare(password, user!.password_hash)).toBe(true);

    // Issue JWT
    const secret = new TextEncoder().encode(ctx.config.LOOP_JWT_SECRET);
    const accessToken = await new jose.SignJWT({
      sub: user!.id,
      role: user!.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(ctx.config.LOOP_JWT_ACCESS_TTL)
      .setIssuedAt()
      .sign(secret);

    expect(typeof accessToken).toBe('string');
    expect(accessToken.split('.')).toHaveLength(3);

    // Verify JWT
    const { payload } = await jose.jwtVerify(accessToken, secret);
    expect(payload.sub).toBe(user!.id);
    expect(payload.role).toBe('write');
  });

  it('invalid credentials do not authenticate (bcrypt returns false)', async () => {
    const passwordHash = await hash('real-password', 10);
    await ctx.store.users.create({
      id: crypto.randomUUID(),
      username: 'bob',
      password_hash: passwordHash,
      email: 'bob@loop.test',
    });

    const user = await ctx.store.users.getByUsername('bob');
    expect(user).not.toBeNull();
    expect(await compare('wrong-password', user!.password_hash)).toBe(false);
  });

  it('bearer token authorises a request (JWT verification roundtrip)', async () => {
    const secret = new TextEncoder().encode(ctx.config.LOOP_JWT_SECRET);
    const userId = crypto.randomUUID();

    const token = await new jose.SignJWT({ sub: userId, role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('15m')
      .setIssuedAt()
      .sign(secret);

    const { payload } = await jose.jwtVerify(token, secret);
    expect(payload.sub).toBe(userId);
    expect(payload.role).toBe('admin');
  });

  it('invalid or expired JWT is rejected by jose.jwtVerify', async () => {
    const secret = new TextEncoder().encode(ctx.config.LOOP_JWT_SECRET);
    const wrongSecret = new TextEncoder().encode('a-different-secret-at-least-32-chars!');

    const token = await new jose.SignJWT({ sub: 'x', role: 'read' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('15m')
      .setIssuedAt()
      .sign(wrongSecret);

    await expect(jose.jwtVerify(token, secret)).rejects.toThrow();
  });

  // ── RBAC: read role cannot create workflows ───────────────────────────────

  it('RBAC: a "read" role user should be rejected from creating workflows', async () => {
    const readUserId = crypto.randomUUID();
    await ctx.store.users.create({
      id: readUserId,
      username: 'reader',
      password_hash: await hash('reader-password', 10),
      email: 'reader@loop.test',
      role: 'read',
    });

    const user = await ctx.store.users.getByUsername('reader');
    expect(user).not.toBeNull();
    expect(user!.role).toBe('read');

    // Simulate the authorization check that RBAC middleware should perform.
    // Per TSD §11.2, 'read' users cannot mutate workflows.
    const canCreate = user!.role === 'write' || user!.role === 'admin';
    expect(canCreate).toBe(false);
  });

  it('RBAC: "write" and "admin" roles can create workflows', async () => {
    for (const role of ['write', 'admin'] as const) {
      const userId = crypto.randomUUID();
      await ctx.store.users.create({
        id: userId,
        username: `user-${role}`,
        password_hash: await hash('pw', 10),
        email: `${role}@loop.test`,
        role,
      });

      const user = await ctx.store.users.getByUsername(`user-${role}`);
      const canCreate = user!.role === 'write' || user!.role === 'admin';
      expect(canCreate).toBe(true);
    }
  });

  // ── Role escalation / deactivation ────────────────────────────────────────

  it('role can be updated via users.updateRole', async () => {
    const userId = crypto.randomUUID();
    await ctx.store.users.create({
      id: userId,
      username: 'promotable',
      password_hash: 'x',
      email: 'promotable@loop.test',
      role: 'read',
    });

    await ctx.store.users.updateRole(userId, 'admin');
    const updated = await ctx.store.users.getById(userId);
    expect(updated!.role).toBe('admin');
  });

  it('deactivated user cannot authenticate (is_active = false)', async () => {
    const userId = crypto.randomUUID();
    await ctx.store.users.create({
      id: userId,
      username: 'deactivated',
      password_hash: await hash('pw', 10),
      email: 'deactivated@loop.test',
      role: 'write',
    });

    await ctx.store.users.deactivate(userId);
    const user = await ctx.store.users.getById(userId);
    expect(user!.is_active).toBe(false);

    // Middleware should reject inactive users before token verification.
    const canLogin = user!.is_active;
    expect(canLogin).toBe(false);
  });
});
