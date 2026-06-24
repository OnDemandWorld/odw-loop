/**
 * E2E — RBAC enforcement.
 *
 * The Loop StateStore supports read/write/admin roles on users. Auth middleware
 * for the HTTP layer is planned but not yet wired in. This test therefore
 * exercises RBAC at the data layer: it verifies that the role model is
 * enforced when code paths honour it, and documents where enforcement is
 * expected but not yet implemented (HTTP middleware).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from './helpers';

/**
 * Simulates an authorisation check that the HTTP middleware would perform.
 * Returns true if the role is allowed to perform the action, false otherwise.
 */
function isAllowed(role: string, action: 'create_workflow' | 'manage_secrets' | 'view_only'): boolean {
  const permissions: Record<string, string[]> = {
    admin: ['create_workflow', 'manage_secrets', 'view_only'],
    write: ['create_workflow', 'view_only'],
    read: ['view_only'],
  };
  return permissions[role]?.includes(action) ?? false;
}

describe('RBAC enforcement (E2E)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('creates users with read, write, and admin roles', async () => {
    const reader = await ctx.store.users.create({
      id: 'user-reader',
      username: 'reader',
      password_hash: 'hashed',
      email: 'reader@loop.test',
      role: 'read',
      display_name: 'Read Only',
    });
    expect(reader.role).toBe('read');

    const writer = await ctx.store.users.create({
      id: 'user-writer',
      username: 'writer',
      password_hash: 'hashed',
      email: 'writer@loop.test',
      role: 'write',
      display_name: 'Writer',
    });
    expect(writer.role).toBe('write');

    const admin = await ctx.store.users.create({
      id: 'user-admin',
      username: 'admin',
      password_hash: 'hashed',
      email: 'admin@loop.test',
      role: 'admin',
      display_name: 'Admin',
    });
    expect(admin.role).toBe('admin');

    const list = await ctx.store.users.list();
    // 3 created + 1 seeded 'system' user from helpers
    expect(list).toHaveLength(4);
  });

  it('read user cannot create workflows (403 semantics)', () => {
    // When HTTP middleware is wired, POST /api/v1/workflows for a read user
    // returns 403 FORBIDDEN_INSUFFICIENT_ROLE. We verify the semantic here.
    expect(isAllowed('read', 'create_workflow')).toBe(false);
  });

  it('write user cannot manage secrets (403 semantics)', () => {
    expect(isAllowed('write', 'manage_secrets')).toBe(false);
  });

  it('admin can do everything', () => {
    expect(isAllowed('admin', 'create_workflow')).toBe(true);
    expect(isAllowed('admin', 'manage_secrets')).toBe(true);
    expect(isAllowed('admin', 'view_only')).toBe(true);
  });

  it('supports role promotion from read → admin', async () => {
    await ctx.store.users.create({
      id: 'user-promote',
      username: 'promote',
      password_hash: 'hashed',
      email: 'promote@loop.test',
      role: 'read',
      display_name: 'Promote Me',
    });

    // Initially read-only
    const before = await ctx.store.users.getById('user-promote');
    expect(before?.role).toBe('read');
    expect(isAllowed(before!.role, 'create_workflow')).toBe(false);

    // Promote to admin
    await ctx.store.users.updateRole('user-promote', 'admin');

    const after = await ctx.store.users.getById('user-promote');
    expect(after?.role).toBe('admin');
    expect(isAllowed(after!.role, 'create_workflow')).toBe(true);
    expect(isAllowed(after!.role, 'manage_secrets')).toBe(true);
  });

  it('deactivated users are flagged inactive', async () => {
    await ctx.store.users.create({
      id: 'user-deact',
      username: 'deact',
      password_hash: 'hashed',
      email: 'deact@loop.test',
      role: 'write',
      display_name: 'Deactivate Me',
    });

    await ctx.store.users.deactivate('user-deact');

    const user = await ctx.store.users.getById('user-deact');
    expect(user?.is_active).toBe(false);
  });
});
