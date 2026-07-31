/**
 * Unit tests — V1.3 RBAC role resolution + route classification (F-RBAC-Loop).
 *
 * Covers the pure helpers in the auth middleware:
 *   - normalizeRole / roleSatisfies (role hierarchy),
 *   - roleFromClaims (JWT `role` / `roles` claim resolution),
 *   - requiredRoleFor (method + path → minimum role, with public exemptions).
 */

import { describe, it, expect } from 'vitest';
import type { JWTPayload } from 'jose';
import {
  normalizeRole,
  roleSatisfies,
  roleFromClaims,
  requiredRoleFor,
  isProtectedPath,
} from '../../../apps/api/src/middleware/auth';

describe('RBAC — role hierarchy helpers', () => {
  it('normalizeRole accepts known roles and rejects others', () => {
    expect(normalizeRole('admin')).toBe('admin');
    expect(normalizeRole('editor')).toBe('editor');
    expect(normalizeRole('viewer')).toBe('viewer');
    expect(normalizeRole('superuser')).toBeUndefined();
    expect(normalizeRole(undefined)).toBeUndefined();
    expect(normalizeRole(42)).toBeUndefined();
  });

  it('roleSatisfies enforces admin > editor > viewer', () => {
    expect(roleSatisfies('admin', 'viewer')).toBe(true);
    expect(roleSatisfies('admin', 'editor')).toBe(true);
    expect(roleSatisfies('admin', 'admin')).toBe(true);
    expect(roleSatisfies('editor', 'editor')).toBe(true);
    expect(roleSatisfies('editor', 'viewer')).toBe(true);
    expect(roleSatisfies('editor', 'admin')).toBe(false);
    expect(roleSatisfies('viewer', 'viewer')).toBe(true);
    expect(roleSatisfies('viewer', 'editor')).toBe(false);
    expect(roleSatisfies('viewer', 'admin')).toBe(false);
  });
});

describe('RBAC — roleFromClaims (JWT)', () => {
  it('reads a scalar role claim', () => {
    expect(roleFromClaims({ role: 'editor' } as JWTPayload)).toBe('editor');
    expect(roleFromClaims({ role: 'admin' } as JWTPayload)).toBe('admin');
  });

  it('ignores an invalid scalar role claim and falls back', () => {
    expect(roleFromClaims({ role: 'root' } as JWTPayload)).toBe('viewer');
  });

  it('reads an array roles claim, picking the highest privilege', () => {
    expect(roleFromClaims({ roles: ['viewer', 'editor'] } as JWTPayload)).toBe('editor');
    expect(roleFromClaims({ roles: ['viewer', 'admin', 'editor'] } as JWTPayload)).toBe('admin');
  });

  it('prefers the scalar role claim over the array', () => {
    expect(roleFromClaims({ role: 'viewer', roles: ['admin'] } as JWTPayload)).toBe('viewer');
  });

  it('defaults to least privilege (viewer) when no role claim is present', () => {
    expect(roleFromClaims({ sub: 'user-1' } as JWTPayload)).toBe('viewer');
    expect(roleFromClaims({ roles: ['nope'] } as JWTPayload)).toBe('viewer');
  });
});

describe('RBAC — requiredRoleFor (route classification)', () => {
  it('exempts public prefixes', () => {
    expect(requiredRoleFor('GET', '/health')).toBeNull();
    expect(requiredRoleFor('GET', '/ready')).toBeNull();
    expect(requiredRoleFor('GET', '/metrics')).toBeNull();
    expect(requiredRoleFor('POST', '/webhooks/abc')).toBeNull();
  });

  it('reads need viewer+', () => {
    expect(requiredRoleFor('GET', '/api/v1/workflows')).toBe('viewer');
    expect(requiredRoleFor('GET', '/api/v1/executions/123')).toBe('viewer');
    expect(requiredRoleFor('GET', '/api/v1/connectors')).toBe('viewer');
    expect(requiredRoleFor('GET', '/api/v1/executions/123/replay')).toBe('viewer');
  });

  it('writes need editor+', () => {
    expect(requiredRoleFor('POST', '/api/v1/workflows')).toBe('editor');
    expect(requiredRoleFor('PUT', '/api/v1/workflows/1')).toBe('editor');
    expect(requiredRoleFor('DELETE', '/api/v1/workflows/1')).toBe('editor');
    expect(requiredRoleFor('POST', '/api/v1/workflows/1/execute')).toBe('editor');
    expect(requiredRoleFor('POST', '/api/v1/executions/1/replay?dryRun=false')).toBe('editor');
  });

  it('admin routes need admin', () => {
    expect(requiredRoleFor('GET', '/api/v1/audit')).toBe('admin');
  });

  it('ignores non-api paths', () => {
    expect(requiredRoleFor('GET', '/')).toBeNull();
    expect(isProtectedPath('/health')).toBe(false);
    expect(isProtectedPath('/api/v1/workflows')).toBe(true);
  });
});
