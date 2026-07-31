/**
 * Authentication guard for the public HTTP API (§11).
 *
 * Backward-compatible by design: enforcement is gated behind `LOOP_REQUIRE_AUTH`
 * (default false / unset = open). When enabled, every `/api/v1/*` request must
 * present either:
 *   - a static API key via `Authorization: Bearer <LOOP_API_KEY>` or `x-api-key`, or
 *   - a valid HS256 JWT (signed with `LOOP_JWT_SECRET`) via `Authorization: Bearer <jwt>`.
 *
 * Public endpoints are always exempt: `/health`, `/ready`, `/metrics`, and the
 * webhook entrypoint `/webhooks/*` (webhooks authenticate via their own HMAC).
 *
 * On success the authenticated principal is attached to `request.authPrincipal`
 * so routes can attribute writes (created_by / updated_by) to the real caller
 * instead of the hardcoded 'system' service account.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import * as jose from 'jose';
import { AuthenticationError } from '@loop/types';
import { createLogger } from '@loop/observability';
import type { LoopConfig } from '../config.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Authenticated principal (user id for JWT, 'system' for a static API key). */
    authPrincipal?: string;
  }
}

const logger = createLogger({ name: 'loop:api:auth', component: 'api' });

/** Path prefixes that are always public, even when auth is enforced. */
const PUBLIC_PREFIXES = ['/health', '/ready', '/metrics', '/webhooks'] as const;

/** The service account a valid static API key authenticates as. */
const API_KEY_PRINCIPAL = 'system';

/** True when the given request URL targets a protected `/api/v1/*` route. */
export function isProtectedPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return false;
  }
  return path.startsWith('/api/v1/');
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

/**
 * Resolve the authenticated principal from the request credentials.
 * Returns null when no presented credential is valid.
 */
async function resolvePrincipal(
  request: FastifyRequest,
  apiKey: string | undefined,
  jwtSecret: Uint8Array,
): Promise<string | null> {
  const headerKey = request.headers['x-api-key'];
  const bearer = extractBearer(request);

  // 1. Static API key (x-api-key header or bearer token matching the key).
  const presentedKey =
    (typeof headerKey === 'string' && headerKey.length > 0 ? headerKey : undefined) ?? bearer;
  if (presentedKey && apiKey && presentedKey === apiKey) {
    return API_KEY_PRINCIPAL;
  }

  // 2. JWT bearer token.
  if (bearer) {
    try {
      const { payload } = await jose.jwtVerify(bearer, jwtSecret);
      if (typeof payload.sub === 'string' && payload.sub.length > 0) {
        return payload.sub;
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
 * Build the onRequest auth guard hook bound to the given config.
 * The hook is a no-op while `LOOP_REQUIRE_AUTH` is false (open access).
 */
export function createAuthGuard(config: LoopConfig) {
  const requireAuth = config.LOOP_REQUIRE_AUTH;
  const apiKey = config.LOOP_API_KEY;
  const jwtSecret = new TextEncoder().encode(config.LOOP_JWT_SECRET);

  return async function authGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!requireAuth) return; // Backward-compatible: open by default.
    if (!isProtectedPath(request.url)) return; // Public endpoints bypass auth.

    const principal = await resolvePrincipal(request, apiKey, jwtSecret);
    if (!principal) {
      throw new AuthenticationError('AUTH_MISSING', 'A valid API key or JWT is required');
    }
    request.authPrincipal = principal;
  };
}
