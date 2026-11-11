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
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { StateStore } from '@loop/state';
import { AuthenticationError } from '@loop/types';
import { createLogger } from '@loop/observability';
import type { LoopConfig } from '../config.js';

const logger = createLogger({ name: 'loop:api:auth-routes', component: 'api' });

/** Legacy users.role → JWT RBAC role mapping (read/viewer, write/editor). */
function mapRole(role: string): 'admin' | 'editor' | 'viewer' {
  if (role === 'admin') return 'admin';
  if (role === 'write') return 'editor';
  return 'viewer';
}

/** Hash a password with scrypt: `scrypt$<saltHex>$<hashHex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time scrypt verification against a stored `scrypt$…$…` hash. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  // Invalid hex (or a zero-length hash) must fail closed — an empty `expected`
  // would make timingSafeEqual compare two empty buffers and return true.
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

const MAX_FAILURES = 5;
const LOCKOUT_BASE_MS = 30_000;
const LOCKOUT_MAX_MS = 15 * 60_000;

/** Per-username failure tracking (process-local). */
const failures = new Map<string, { count: number; lockedUntil: number }>();

function registerFailure(username: string): void {
  const entry = failures.get(username) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) {
    const lockout = Math.min(LOCKOUT_BASE_MS * 2 ** (entry.count - MAX_FAILURES), LOCKOUT_MAX_MS);
    entry.lockedUntil = Date.now() + lockout;
  }
  failures.set(username, entry);
}

function isLocked(username: string): boolean {
  const entry = failures.get(username);
  if (!entry) return false;
  return entry.lockedUntil > Date.now();
}

function clearFailures(username: string): void {
  failures.delete(username);
}

/** Parse a TTL duration string ('90s', '15m', '12h', '7d') into seconds. */
function ttlSeconds(ttl: string | undefined): number {
  const match = /^(\d+)\s*([smhd])$/.exec((ttl ?? '').trim());
  if (!match) return 15 * 60; // missing/unparseable → the schema default (15m)
  const n = Number(match[1]);
  const unit = match[2];
  const mult = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return n * mult;
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
    const ok = storedHash.length > 0 && verifyPassword(password, storedHash);
    if (!ok || !user || !user.is_active) {
      registerFailure(username);
      // Uniform error — never reveal whether the account exists.
      throw new AuthenticationError('AUTH_MISSING', 'Invalid username or password');
    }

    clearFailures(username);
    await deps.store.users.updateLastLogin(user.id).catch(() => {});

    const secret = new TextEncoder().encode(deps.config.LOOP_JWT_SECRET);
    const now = Math.floor(Date.now() / 1000);
    // Honour LOOP_JWT_ACCESS_TTL (default 15m) — the lifetime was previously
    // hardcoded to 12h, so the configured TTL was dead config.
    const ttl = ttlSeconds(deps.config.LOOP_JWT_ACCESS_TTL);
    const token = await new SignJWT({ role: mapRole(user.role) })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuedAt(now)
      .setExpirationTime(now + ttl)
      .sign(secret);

    logger.info({ username }, 'User login succeeded');
    return reply.status(200).send({
      success: true,
      data: {
        token,
        token_type: 'Bearer',
        expires_in: ttl,
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
    password_hash: hashPassword(password),
    email: config.LOOP_BOOTSTRAP_ADMIN_EMAIL ?? `${username}@localhost`,
    role: 'admin',
    display_name: 'Bootstrap Admin',
  });
  logger.info({ username }, 'Bootstrap admin user created from LOOP_BOOTSTRAP_ADMIN_*');
}
