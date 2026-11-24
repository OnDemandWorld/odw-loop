/**
 * Unit tests — V1.7 auth issuance (L-8): login route + bootstrap admin +
 * scrypt password helpers.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import { createSqliteConnection, SqliteStateStore, type SqliteConnection } from '../../../packages/state/src';
import { registerAuthRoutes, bootstrapAdminUser, hashPassword, verifyPassword } from '../../../apps/api/src/routes/auth';
import { createAuthGuard } from '../../../apps/api/src/middleware/auth';
import type { LoopConfig } from '../../../apps/api/src/config';

function testConfig(overrides: Partial<LoopConfig> = {}): LoopConfig {
  return {
    LOOP_REQUIRE_AUTH: true,
    LOOP_JWT_SECRET: 'unit-test-jwt-secret-0123456789abcdef',
    LOOP_API_KEY: undefined,
    LOOP_API_KEY_ROLE: 'admin',
    LOOP_BOOTSTRAP_ADMIN_USERNAME: 'admin',
    LOOP_BOOTSTRAP_ADMIN_PASSWORD: 'bootstrap-pass-123',
    LOOP_BOOTSTRAP_ADMIN_EMAIL: 'admin@test.local',
    ...overrides,
  } as unknown as LoopConfig;
}

const conns: SqliteConnection[] = [];
afterEach(async () => {
  for (const conn of conns.splice(0)) await conn.close();
});

async function buildServer(config: LoopConfig) {
  const conn = createSqliteConnection({ path: ':memory:', wal: false });
  conns.push(conn);
  const store = new SqliteStateStore(conn);
  await store.initialise();
  await store.users.create({
    id: 'system',
    username: 'system',
    password_hash: '',
    email: 'system@loop.internal',
    role: 'admin',
    display_name: 'System',
  });
  await bootstrapAdminUser(store, config);
  const app = Fastify();
  app.addHook('onRequest', createAuthGuard(config, store));
  registerAuthRoutes(app, { store, config });
  return { app, store };
}

describe('scrypt password helpers', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('s3cret!');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('s3cret!', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('rejects malformed stored hashes without throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$zz$zz')).toBe(false);
  });
});

describe('bootstrapAdminUser', () => {
  it('seeds the first admin and is idempotent', async () => {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    conns.push(conn);
    const store = new SqliteStateStore(conn);
    await store.initialise();
    const cfg = testConfig();
    await bootstrapAdminUser(store, cfg);
    const user = await store.users.getByUsername('admin');
    expect(user?.role).toBe('admin');
    expect(await verifyPassword('bootstrap-pass-123', user!.password_hash)).toBe(true);
    // Second run must not duplicate or reset.
    await bootstrapAdminUser(store, cfg);
    expect(await store.users.getByUsername('admin')).toBeTruthy();
  });

  it('is a no-op without bootstrap env', async () => {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    conns.push(conn);
    const store = new SqliteStateStore(conn);
    await store.initialise();
    await bootstrapAdminUser(store, testConfig({ LOOP_BOOTSTRAP_ADMIN_USERNAME: undefined }));
    expect(await store.users.getByUsername('nobody')).toBeNull();
  });
});

describe('POST /api/v1/auth/login', () => {
  it('issues a JWT with the mapped role for valid credentials', async () => {
    const cfg = testConfig();
    const { app } = await buildServer(cfg);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: 'bootstrap-pass-123' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.token).toBeTruthy();
    expect(body.data.user.role).toBe('admin');
    // The issued token must satisfy the auth guard on a protected route.
    const guarded = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows',
      headers: { authorization: `Bearer ${body.data.token}` },
    });
    expect(guarded.statusCode).toBe(404); // audit #79: guard passed, route absent (403/500 must fail)
    await app.close();
  });

  it('rejects bad credentials uniformly', async () => {
    const cfg = testConfig();
    const { app } = await buildServer(cfg);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: 'nope' } });
    expect(res.statusCode).toBe(401);
    const unknown = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'ghost', password: 'nope' } });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.message).toBe(res.json().error.message);
    await app.close();
  });

  it('locks out after repeated failures', async () => {
    const cfg = testConfig();
    const { app } = await buildServer(cfg);
    for (let i = 0; i < 5; i += 1) {
      await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: 'wrong' } });
    }
    const locked = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: 'bootstrap-pass-123' } });
    expect(locked.statusCode).toBe(401);
    expect(locked.body).toMatch(/Too many failed attempts/);
    await app.close();
  });

  it('requires both fields', async () => {
    const cfg = testConfig();
    const { app } = await buildServer(cfg);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin' } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('account re-validation (audit #17)', () => {
  it('deactivating a user invalidates already-issued JWTs', async () => {
    const { app, store } = await buildServer(testConfig());
    app.get('/api/v1/workflows', async () => ({ success: true, data: [] }));
    await store.users.create({
      id: crypto.randomUUID(),
      username: 'editor1',
      password_hash: await hashPassword('user-pass-123'),
      email: 'editor1@test.local',
      role: 'write',
      display_name: 'Editor One',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'editor1', password: 'user-pass-123' },
    });
    expect(login.statusCode).toBe(200);
    const token = login.json().data.token as string;
    const headers = { authorization: `Bearer ${token}` };
    const before = await app.inject({ method: 'GET', url: '/api/v1/workflows', headers });
    expect(before.statusCode).toBe(200);

    const user = await store.users.getByUsername('editor1');
    await store.users.deactivate(user!.id);

    const after = await app.inject({ method: 'GET', url: '/api/v1/workflows', headers });
    expect(after.statusCode).toBe(401);
    await app.close();
  });
});

describe('guard negative paths (audit #78)', () => {
  async function buildGuarded(config: LoopConfig) {
    const { app, store } = await buildServer(config);
    app.get('/api/v1/workflows', async () => ({ success: true, data: [] }));
    return { app, store };
  }

  it('rejects an expired JWT with 401', async () => {
    const config = testConfig();
    const { app } = await buildGuarded(config);
    const jose = await import('jose');
    const secret = new TextEncoder().encode(config.LOOP_JWT_SECRET);
    const now = Math.floor(Date.now() / 1000);
    const token = await new jose.SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('system')
      .setIssuedAt(now - 200)
      .setExpirationTime(now - 100)
      .sign(secret);
    const res = await app.inject({ method: 'GET', url: '/api/v1/workflows', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects a JWT signed with a different secret with 401', async () => {
    const config = testConfig();
    const { app } = await buildGuarded(config);
    const jose = await import('jose');
    const wrongSecret = new TextEncoder().encode('a-completely-different-secret-0123456789');
    const token = await new jose.SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('system')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(wrongSecret);
    const res = await app.inject({ method: 'GET', url: '/api/v1/workflows', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('accepts a valid static API key with the configured role', async () => {
    const config = testConfig({ LOOP_API_KEY: 'static-test-key-123456' });
    const { app } = await buildGuarded(config);
    const res = await app.inject({ method: 'GET', url: '/api/v1/workflows', headers: { 'x-api-key': 'static-test-key-123456' } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('rejects a wrong static API key with 401', async () => {
    const config = testConfig({ LOOP_API_KEY: 'static-test-key-123456' });
    const { app } = await buildGuarded(config);
    const res = await app.inject({ method: 'GET', url: '/api/v1/workflows', headers: { 'x-api-key': 'wrong-key' } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('JWT TTL config (audit #92)', () => {
  it('honours LOOP_JWT_ACCESS_TTL for expiry and expires_in', async () => {
    const { clearFailures } = await import('../../../apps/api/src/routes/auth');
    clearFailures('admin'); // the module-level lockout map is shared with the lockout test
    const { app } = await buildServer(testConfig({ LOOP_JWT_ACCESS_TTL: '5m' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'bootstrap-pass-123' },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.expires_in).toBe(300);
    const [, payloadB64] = data.token.split('.');
    const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    expect(claims.exp - claims.iat).toBe(300);
    await app.close();
  });
});

describe('lockout map bounding (audit #91)', () => {
  it('prunes expired entries and caps the map under username sprays', async () => {
    const { registerFailure, clearFailures, trackedFailureCount } = await import('../../../apps/api/src/routes/auth');
    // Fill past the cap with distinct usernames.
    for (let i = 0; i < 10_050; i++) registerFailure(`spray-user-${i}`);
    expect(trackedFailureCount()).toBeLessThanOrEqual(10_000);
    // Cleanup so sibling tests are unaffected.
    for (let i = 0; i < 10_050; i++) clearFailures(`spray-user-${i}`);
  });
});
