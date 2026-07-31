/**
 * Authentication + role-based access control (RBAC) guard for the public HTTP
 * API (§11, V1.3 M2 F-RBAC-Loop).
 *
 * Backward-compatible by design: enforcement is gated behind `LOOP_REQUIRE_AUTH`
 * (default false / unset = fully open). When enabled, every `/api/v1/*` request
 * must present either:
 *   - a static API key via `Authorization: Bearer <LOOP_API_KEY>` or `x-api-key`, or
 *   - a valid HS256 JWT (signed with `LOOP_JWT_SECRET`) via `Authorization: Bearer <jwt>`.
 *
 * Roles (V1.3): `admin` > `editor` > `viewer`. The role is resolved from the
 * JWT `role`/`roles` claim, or — for a static API key — from `LOOP_API_KEY_ROLE`
 * (default `admin`, dev-friendly). Routes are guarded by minimum role:
 *   - reads (GET workflows/executions/connectors) → `viewer+`
 *   - writes (POST/PUT/DELETE workflows, POST execute) → `editor+`
 *   - admin routes (`/api/v1/audit`) → `admin`
 * Public endpoints are always exempt: `/health`, `/ready`, `/metrics`, and the
 * webhook entrypoint `/webhooks/*` (webhooks authenticate via their own HMAC).
 *
 * On success the authenticated principal AND role are attached to the request
 * (`request.authPrincipal` / `request.authRole`) so routes can attribute writes
 * and apply explicit `requireRole(min)` guards.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import * as jose from 'jose';
import { AuthenticationError, ForbiddenError } from '@loop/types';
import { createLogger } from '@loop/observability';
import type { LoopConfig } from '../config.js';

/** RBAC roles, ordered by privilege (V1.3 M2). */
export type Role = 'admin' | 'editor' | 'viewer';

/** Numeric privilege ranking used for "minimum role" comparisons. */
const ROLE_RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };

declare module 'fastify' {
  interface FastifyRequest {
    /** Authenticated principal (user id for JWT, 'system' for a static API key). */
    authPrincipal?: string;
    /** Resolved RBAC role (V1.3). Present only once authentication succeeded. */
    authRole?: Role;
  }
}

const logger = createLogger({ name: 'loop:api:auth', component: 'api' });

/** Path prefixes that are always public, even when auth is enforced. */
const PUBLIC_PREFIXES = ['/health', '/ready', '/metrics', '/webhooks'] as const;

/** The service account a valid static API key authenticates as. */
const API_KEY_PRINCIPAL = 'system';

/** True when a string is a known RBAC role. */
export function normalizeRole(value: unknown): Role | undefined {
  if (value === 'admin' || value === 'editor' || value === 'viewer') return value;
  return undefined;
}

/** True when `actual` satisfies a `min` minimum-role requirement. */
export function roleSatisfies(actual: Role, min: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[min];
}

/**
 * Resolve an RBAC role from verified JWT claims. Honours a scalar `role` claim
 * first, then an array `roles` claim (highest privilege wins). A JWT with no
 * recognisable role claim defaults to least privilege (`viewer`).
 */
export function roleFromClaims(payload: jose.JWTPayload): Role {
  const direct = normalizeRole(payload['role']);
  if (direct) return direct;

  const roles = payload['roles'];
  if (Array.isArray(roles)) {
    let best: Role | undefined;
    for (const entry of roles) {
      const candidate = normalizeRole(entry);
      if (candidate && (best === undefined || ROLE_RANK[candidate] > ROLE_RANK[best])) {
        best = candidate;
      }
    }
    if (best) return best;
  }

  return 'viewer';
}

/** True when the given request URL targets a protected `/api/v1/*` route. */
export function isProtectedPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return false;
  }
  return path.startsWith('/api/v1/');
}

/**
 * Minimum role required for a request, or `null` when the route is exempt
 * (public prefixes and non-`/api/v1` paths). Reads need `viewer+`, admin
 * routes need `admin`, and every other write verb needs `editor+`.
 */
export function requiredRoleFor(method: string, url: string): Role | null {
  const path = url.split('?')[0] ?? url;
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return null;
  }
  if (!path.startsWith('/api/v1/')) return null;

  // Admin-only system routes.
  if (path === '/api/v1/audit' || path.startsWith('/api/v1/audit/')) {
    return 'admin';
  }

  const verb = method.toUpperCase();
  if (verb === 'GET' || verb === 'HEAD') return 'viewer';
  return 'editor'; // POST / PUT / DELETE / PATCH
}

/** Extract a bearer token from the Authorization header, if present. */
function extractBearer(request: FastifyRequest): string | undefined {
  const header = request.headers['authorization'];
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    return token.length > 0 ? token : undefined;
  }
  return undefined;
}

/** An authenticated identity: who the caller is plus their RBAC role. */
interface Identity {
  principal: string;
  role: Role;
}

/**
 * Resolve the authenticated identity (principal + role) from the request
 * credentials. Returns null when no presented credential is valid.
 */
async function resolveIdentity(
  request: FastifyRequest,
  apiKey: string | undefined,
  apiKeyRole: Role,
  jwtSecret: Uint8Array,
): Promise<Identity | null> {
  const headerKey = request.headers['x-api-key'];
  const bearer = extractBearer(request);

  // 1. Static API key (x-api-key header or bearer token matching the key).
  const presentedKey =
    (typeof headerKey === 'string' && headerKey.length > 0 ? headerKey : undefined) ?? bearer;
  if (presentedKey && apiKey && presentedKey === apiKey) {
    return { principal: API_KEY_PRINCIPAL, role: apiKeyRole };
  }

  // 2. JWT bearer token.
  if (bearer) {
    try {
      const { payload } = await jose.jwtVerify(bearer, jwtSecret);
      if (typeof payload.sub === 'string' && payload.sub.length > 0) {
        return { principal: payload.sub, role: roleFromClaims(payload) };
      }
    } catch {
      // Not a valid JWT — fall through to reject.
      logger.debug('Bearer token failed JWT verification');
    }
  }

  return null;
}

/**
 * Resolve a principal from a single presented token (V1.1 M2, F5).
 *
 * Used by transports that cannot use the full header-based flow — notably the
 * `GET /ws/executions/:id` WebSocket upgrade, where browsers authenticate via a
 * `?token=` query value. Accepts either the static API key or a valid JWT.
 * Returns null when the token is absent or invalid.
 */
export async function resolveTokenPrincipal(
  token: string | undefined,
  config: LoopConfig,
): Promise<string | null> {
  if (!token) return null;

  // 1. Static API key.
  const apiKey = config.LOOP_API_KEY;
  if (apiKey && token === apiKey) {
    return API_KEY_PRINCIPAL;
  }

  // 2. JWT bearer token.
  try {
    const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(config.LOOP_JWT_SECRET));
    if (typeof payload.sub === 'string' && payload.sub.length > 0) {
      return payload.sub;
    }
  } catch {
    logger.debug('Presented token failed JWT verification');
  }

  return null;
}

/**
 * Route-level minimum-role guard factory (V1.3 M2).
 *
 * Returns a preHandler that rejects the request with 403 when the authenticated
 * role (set by the auth guard) is below `min`. Backward compatible: when auth is
 * disabled no role is attached, so the guard is a no-op (open access).
 */
export function requireRole(min: Role) {
  return async function roleGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const role = request.authRole;
    if (role === undefined) return; // Auth off → open (backward compatible).
    if (!roleSatisfies(role, min)) {
      throw new ForbiddenError(`Role '${role}' does not satisfy the required '${min}' role`);
    }
  };
}

/**
 * Build the onRequest auth + RBAC guard hook bound to the given config.
 * The hook is a no-op while `LOOP_REQUIRE_AUTH` is false (open access).
 */
export function createAuthGuard(config: LoopConfig) {
  const requireAuth = config.LOOP_REQUIRE_AUTH;
  const apiKey = config.LOOP_API_KEY;
  const apiKeyRole = config.LOOP_API_KEY_ROLE;
  const jwtSecret = new TextEncoder().encode(config.LOOP_JWT_SECRET);

  return async function authGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!requireAuth) return; // Backward-compatible: open by default.
    if (!isProtectedPath(request.url)) return; // Public endpoints bypass auth.

    const identity = await resolveIdentity(request, apiKey, apiKeyRole, jwtSecret);
    if (!identity) {
      throw new AuthenticationError('AUTH_MISSING', 'A valid API key or JWT is required');
    }
    request.authPrincipal = identity.principal;
    request.authRole = identity.role;

    // Route-level RBAC: enforce the minimum role for this method + path.
    const required = requiredRoleFor(request.method, request.url);
    if (required && !roleSatisfies(identity.role, required)) {
      throw new ForbiddenError(
        `Role '${identity.role}' is not permitted to ${request.method} ${request.url.split('?')[0]} (requires '${required}')`,
      );
    }
  };
}
