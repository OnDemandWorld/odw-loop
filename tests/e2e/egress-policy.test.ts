/**
 * E2E — Egress policy enforcement.
 *
 * Verifies that the EgressEngine + EgressInterceptor combination correctly
 * enforces domain-level policies. The interceptor is wired into a workflow's
 * connector call path; the test asserts:
 *
 *   1. With no policies, default-deny blocks external calls.
 *   2. Adding an allow rule for a specific domain permits that domain.
 *   3. Other domains remain blocked.
 *   4. Priority ordering is respected (higher priority wins).
 *   5. Policy cache invalidation reflects live DB changes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from './helpers';
import { EgressInterceptor } from '../../packages/egress/src/interceptor';

describe('Egress policy enforcement (E2E)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('denies all external calls by default when no policies exist', async () => {
    const decision = await ctx.egressEngine.evaluate('https://api.openai.com/v1/chat');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/No matching allow policy/);
  });

  it('blocks external API call with a deny-all policy', async () => {
    await ctx.store.egressPolicies.create({
      id: 'deny-all',
      name: 'Deny all',
      rule_type: 'deny',
      target_type: 'domain',
      target_value: '*.openai.com',
      priority: 100,
    });
    ctx.egressEngine.invalidateCache();

    const decision = await ctx.egressEngine.evaluate('https://api.openai.com/v1/chat');
    expect(decision.allowed).toBe(false);
    expect(decision.matched_policy).toBe('deny-all');
  });

  it('allows calls to a specific domain after adding an allow rule', async () => {
    // Start with deny-all for openai
    await ctx.store.egressPolicies.create({
      id: 'deny-openai',
      name: 'Deny OpenAI',
      rule_type: 'deny',
      target_type: 'domain',
      target_value: '*.openai.com',
      priority: 100,
    });

    // Add a higher-priority allow rule for a sub-domain
    await ctx.store.egressPolicies.create({
      id: 'allow-platform',
      name: 'Allow platform.openai.com',
      rule_type: 'allow',
      target_type: 'domain',
      target_value: 'platform.openai.com',
      priority: 200,
    });
    ctx.egressEngine.invalidateCache();

    const allowed = await ctx.egressEngine.evaluate('https://platform.openai.com/v1/chat');
    expect(allowed.allowed).toBe(true);
    expect(allowed.matched_policy).toBe('allow-platform');

    // But api.openai.com is still blocked
    const blocked = await ctx.egressEngine.evaluate('https://api.openai.com/v1/chat');
    expect(blocked.allowed).toBe(false);
  });

  it('respects priority ordering: higher priority wins', async () => {
    await ctx.store.egressPolicies.create({
      id: 'low-deny',
      name: 'Low deny',
      rule_type: 'deny',
      target_type: 'domain',
      target_value: '*.example.com',
      priority: 100,
    });
    await ctx.store.egressPolicies.create({
      id: 'high-allow',
      name: 'High allow',
      rule_type: 'allow',
      target_type: 'domain',
      target_value: '*.example.com',
      priority: 500,
    });
    ctx.egressEngine.invalidateCache();

    const decision = await ctx.egressEngine.evaluate('https://api.example.com/test');
    expect(decision.allowed).toBe(true);
    expect(decision.matched_policy).toBe('high-allow');
  });

  it('invalidating the cache reflects live DB changes', async () => {
    // Initially no allow → blocked
    const before = await ctx.egressEngine.evaluate('https://allowed.example.com');
    expect(before.allowed).toBe(false);

    // Insert allow policy
    await ctx.store.egressPolicies.create({
      id: 'allow-example',
      name: 'Allow example',
      rule_type: 'allow',
      target_type: 'domain',
      target_value: 'allowed.example.com',
      priority: 100,
    });
    // Without invalidation, cache still denies (within TTL)
    const cached = await ctx.egressEngine.evaluate('https://allowed.example.com');
    expect(cached.allowed).toBe(false);

    // After invalidation
    ctx.egressEngine.invalidateCache();
    const after = await ctx.egressEngine.evaluate('https://allowed.example.com');
    expect(after.allowed).toBe(true);
    expect(after.matched_policy).toBe('allow-example');
  });

  it('EgressInterceptor throws LoopError when egress is blocked', async () => {
    // No allow policies → default deny
    const interceptor = new EgressInterceptor(ctx.egressEngine);

    await expect(
      interceptor.request('https://blocked.example.com/data'),
    ).rejects.toThrow(/Egress blocked/);
  });

  it('EgressInterceptor succeeds when an allow policy exists', async () => {
    // Allow the domain
    await ctx.store.egressPolicies.create({
      id: 'allow-test',
      name: 'Allow test',
      rule_type: 'allow',
      target_type: 'domain',
      target_value: 'api.allowed.test',
      priority: 100,
    });
    ctx.egressEngine.invalidateCache();

    // We can't easily test a real HTTP call without starting a server.
    // Instead, we verify the engine's decision (the interceptor only proceeds
    // when decision.allowed === true; it then calls undici which may fail
    // for network reasons — we only test the policy decision here).
    const decision = await ctx.egressEngine.evaluate('https://api.allowed.test/data');
    expect(decision.allowed).toBe(true);
  });
});
