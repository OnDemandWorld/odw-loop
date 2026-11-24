/**
 * Auth routes — JWT issuance for the RBAC guard (V1.7, L-8).
 *
 * Previously the API could VERIFY JWTs but nothing issued them: the only
 * usable credential was the shared static `LOOP_API_KEY`, so editor/viewer
 * roles were unreachable in practice. This module closes the loop:
 *   - `POST /api/v1/auth/login` verifies username+password (scrypt) against
 *     the `users` table and returns a signed HS256 JWT carrying the mapped
 *     RBAC role claim.
 *   - `bootstrapAdminUser` seeds the first admin from
 *     `LOOP_BOOTSTRAP_ADMIN_*` env at startup so a locked-down deployment has
 *     a real login before any user exists.
 *
 * Login rate limiting: a small in-memory per-username failure counter with
 * exponential lockout (5 failures → 30s doubling, cap 15 min). Process-local —
 * sufficient for single-node self-hosting; revisit for multi-replica.
 */

import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
import type { StateStore } from '@loop/state';
import { AuthenticationError } from '@loop/types';
import { createLogger } from '@loop/observability';
import type { LoopConfig } from '../config.js';

const logger = createLogger({ name: 'loop:api:auth-routes', component: 'api' });

/** Parse a TTL like '15m' / '12h' / '7d' / '30s' into seconds (audit #92). */
function parseTtlSeconds(ttl: string, fallback: number): number {
  const m = /^(\d+)([smhd])$/.exec((ttl ?? '').trim());
  if (!m) return fallback;
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(m[1]) * (mult[m[2]!] ?? 1);
}

/** Legacy users.role → JWT RBAC role mapping (read/viewer, write/editor). */
function mapRole(role: string): 'admin' | 'editor' | 'viewer' {
  if (role === 'admin') return 'admin';
  if (role === 'write') return 'editor';
  return 'viewer';
}

/** Hash a password with scrypt: `scrypt$<saltHex>$<hashHex>`.
 *  Audit #90: async KDF — scryptSync blocked the event loop for every login. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time scrypt verification against a stored `scrypt$…$…` hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  // Invalid hex (or a zero-length hash) must fail closed — an empty `expected`
  // would make timingSafeEqual compare two empty buffers and return true.
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = await scryptAsync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

const MAX_FAILURES = 5;
const LOCKOUT_BASE_MS = 30_000;
const LOCKOUT_MAX_MS = 15 * 60_000;

/** Per-username failure tracking (process-local). */
const failures = new Map<string, { count: number; lockedUntil: number }>();
const MAX_TRACKED_USERS = 10_000;

export function registerFailure(username: string): void {
  // Audit #91: bound the map — random-username sprays must not grow it
  // forever. Prune expired below-threshold entries, then oldest if still full.
  if (failures.size >= MAX_TRACKED_USERS && !failures.has(username)) {
    const now = Date.now();
    for (const [k, v] of failures) {
      if (v.lockedUntil <= now && v.count < MAX_FAILURES) failures.delete(k);
    }
    if (failures.size >= MAX_TRACKED_USERS) {
      const excess = failures.size - MAX_TRACKED_USERS + 1;
      let i = 0;
      for (const k of failures.keys()) {
        if (i++ >= excess) break;
        failures.delete(k);
      }
    }
  }
  const entry = failures.get(username) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) {
    const lockout = Math.min(LOCKOUT_BASE_MS * 2 ** (entry.count - MAX_FAILURES), LOCKOUT_MAX_MS);
    entry.lockedUntil = Date.now() + lockout;
  }
  failures.set(username, entry);
}

export function isLocked(username: string): boolean {
  const entry = failures.get(username);
  if (!entry) return false;
  return entry.lockedUntil > Date.now();
}

export function clearFailures(username: string): void {
  failures.delete(username);
}

/** Test/observability hook: current tracked-username count (audit #91). */
export function trackedFailureCount(): number {
  return failures.size;
}

export interface AuthRoutesDeps {
  store: StateStore;
  config: LoopConfig;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDeps): void {
  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = (request.body ?? {}) as { username?: unknown; password?: unknown };
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (username.length === 0 || password.length === 0) {
      throw new AuthenticationError('AUTH_MISSING', 'username and password are required');
    }
    if (isLocked(username)) {
      throw new AuthenticationError('AUTH_MISSING', 'Too many failed attempts — try again later');
    }

    const user = await deps.store.users.getByUsername(username);
    const storedHash = user?.password_hash ?? '';
    const ok = storedHash.length > 0 && (await verifyPassword(password, storedHash));
    if (!ok || !user || !user.is_active) {
      registerFailure(username);
      // Uniform error — never reveal whether the account exists.
      throw new AuthenticationError('AUTH_MISSING', 'Invalid username or password');
    }

    clearFailures(username);
    await deps.store.users.updateLastLogin(user.id).catch(() => {});

    const secret = new TextEncoder().encode(deps.config.LOOP_JWT_SECRET);
    const now = Math.floor(Date.now() / 1000);
    // Audit #92: honour LOOP_JWT_ACCESS_TTL (was hard-coded 12h, ignoring config).
    const ttlSeconds = parseTtlSeconds(deps.config.LOOP_JWT_ACCESS_TTL, 15 * 60);
    const token = await new SignJWT({ role: mapRole(user.role) })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuedAt(now)
      .setExpirationTime(now + ttlSeconds)
      .sign(secret);

    logger.info({ username }, 'User login succeeded');
    return reply.status(200).send({
      success: true,
      data: {
        token,
        token_type: 'Bearer',
        expires_in: ttlSeconds,
        user: { id: user.id, username: user.username, email: user.email, role: mapRole(user.role) },
      },
    });
  });
}

/**
 * Seed the first admin from `LOOP_BOOTSTRAP_ADMIN_*` env (idempotent — an
 * existing user with that username is left untouched, whatever its role).
 */
export async function bootstrapAdminUser(store: StateStore, config: LoopConfig): Promise<void> {
  const username = config.LOOP_BOOTSTRAP_ADMIN_USERNAME;
  const password = config.LOOP_BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !password) return;
  const existing = await store.users.getByUsername(username).catch(() => null);
  if (existing) {
    logger.debug({ username }, 'Bootstrap admin already exists — skipping');
    return;
  }
  const { randomUUID } = await import('node:crypto');
  await store.users.create({
    id: randomUUID(),
    username,
    password_hash: await hashPassword(password),
    email: config.LOOP_BOOTSTRAP_ADMIN_EMAIL ?? `${username}@localhost`,
    role: 'admin',
    display_name: 'Bootstrap Admin',
  });
  logger.info({ username }, 'Bootstrap admin user created from LOOP_BOOTSTRAP_ADMIN_*');
}
