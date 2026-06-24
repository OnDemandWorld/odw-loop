/**
 * Integration tests — egress policy enforcement.
 *
 * Creates egress policies via the state store, then uses the EgressEngine to
 * evaluate whether URLs are allowed. This verifies the policy loader, cache,
 * priority ordering, and default-deny behaviour.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSqliteConnection,
  SqliteStateStore,
  type SqliteConnection,
} from '../../../packages/state/src/index.js';
import { EgressEngine, EgressInterceptor } from '../../../packages/egress/src/index.js';
import { LoopError } from '../../../packages/types/src/index.js';

// Mock the resolver so tests are deterministic (no real DNS).
vi.mock('../../../packages/egress/src/resolver.js', () => ({
  resolveIP: (hostname: string): string => {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;
    const map: Record<string, string> = {
      'allowed.example.com': '93.184.216.10',
      'blocked.example.com': '198.51.100.20',
      'partner.api.test': '203.0.113.50',
      'subdomain.partner.api.test': '203.0.113.51',
    };
    return map[hostname] ?? hostname;
  },
  lookupRegion: (ip: string): string => {
    if (ip.startsWith('203.0.113.')) return 'EU';
    if (ip.startsWith('93.184.')) return 'US';
    if (ip.startsWith('198.51.')) return 'RU';
    return '';
  },
}));

describe('Egress policy enforcement', () => {
  let conn: SqliteConnection;
  let store: SqliteStateStore;
  let engine: EgressEngine;

  beforeEach(async () => {
    conn = createSqliteConnection({ path: ':memory:', wal: false });
    store = new SqliteStateStore(conn);
    await store.initialise();
    engine = new EgressEngine(() => store.egressPolicies.listEnabled());
  });

  it('default deny — URL without a matching allow policy is blocked', async () => {
    const decision = await engine.evaluate('https://unknown.example.com/anything');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/default deny|No matching allow policy/i);
  });

  it('allow policy for a specific domain permits the URL', async () => {
    await store.egressPolicies.create({
      id: 'p1',
      name: 'Allow allowed.example.com',
      rule_type: 'allow',
      target_type: 'domain',
      target_value: 'allowed.example.com',
      priority: 10,
    });
    engine.invalidateCache();

    const decision = await engine.evaluate('https://allowed.example.com/resource');
    expect(decision.allowed).toBe(true);
    expect(decision.matched_policy).toBe('p1');
  });

  it('deny policy overrides lower-priority allow policy', async () => {
    await store.egressPolicies.create({
      id: 'p-allow',
      name: 'Allow partner.api.test',
      rule_type: 'allow',
      target_type: 'domain',
      target_value: 'partner.api.test',
      priority: 10,
    });
    await store.egressPolicies.create({
      id: 'p-deny',
      name: 'Block partner.api.test',
      rule_type: 'deny',
      target_type: 'domain',
      target_value: 'partner.api.test',
      priority: 100,
    });
    engine.invalidateCache();

    const decision = await engine.evaluate('https://partner.api.test/x');
    expect(decision.allowed).toBe(false);
    expect(decision.matched_policy).toBe('p-deny');
  });

  it('wildcard domain policy matches subdomains', async () => {
    await store.egressPolicies.create({
      id: 'wc',
      name: 'Allow partner.api.test and subdomains',
      rule_type: 'allow',
      target_type: 'domain',
      target_value: '*.partner.api.test',
      priority: 10,
    });
    engine.invalidateCache();

    const decision = await engine.evaluate('https://subdomain.partner.api.test/endpoint');
    expect(decision.allowed).toBe(true);
    expect(decision.matched_policy).toBe('wc');
  });

  it('deny policy blocks a domain while allowing others', async () => {
    await store.egressPolicies.create({
      id: 'deny-blocked',
      name: 'Deny blocked.example.com',
      rule_type: 'deny',
      target_type: 'domain',
      target_value: 'blocked.example.com',
      priority: 50,
    });
    await store.egressPolicies.create({
      id: 'allow-all',
      name: 'Allow everything else',
      rule_type: 'allow',
      target_type: 'domain',
      target_value: '*.example.com',
      priority: 10,
    });
    engine.invalidateCache();

    const allowedDecision = await engine.evaluate('https://allowed.example.com/');
    expect(allowedDecision.allowed).toBe(true);

    const blockedDecision = await engine.evaluate('https://blocked.example.com/');
    expect(blockedDecision.allowed).toBe(false);
    expect(blockedDecision.matched_policy).toBe('deny-blocked');
  });

  it('disabled policy is ignored', async () => {
    await store.egressPolicies.create({
      id: 'p-disabled',
      name: 'Disabled allow',
      rule_type: 'allow',
      target_type: 'domain',
      target_value: 'allowed.example.com',
      priority: 100,
    });
    await store.egressPolicies.update('p-disabled', { enabled: false });
    engine.invalidateCache();

    // Despite the policy matching the domain, it's disabled, so default deny applies.
    const decision = await engine.evaluate('https://allowed.example.com/');
    expect(decision.allowed).toBe(false);
  });

  it('EgressInterceptor throws LoopError when egress is blocked', async () => {
    // No allow policy → default deny
    const interceptor = new EgressInterceptor(engine);

    await expect(
      interceptor.request('https://blocked.example.com/anything'),
    ).rejects.toThrow(/Egress blocked/);

    try {
      await interceptor.request('https://blocked.example.com/anything');
    } catch (err) {
      // Verify via duck-typing because module identity can differ across
      // pnpm's module graph.
      const loopErr = err as { name?: string; code?: string; statusCode?: number };
      expect(loopErr.name).toBe('LoopError');
      expect(loopErr.code).toBe('NODE_EGRESS_BLOCKED');
      expect(loopErr.statusCode).toBe(403);
    }
  });

  it('egressPolicies.listEnabled only returns enabled policies', async () => {
    await store.egressPolicies.create({
      id: 'e1',
      name: 'Enabled',
      rule_type: 'allow',
      target_type: 'domain',
      target_value: 'x.test',
      priority: 10,
    });
    await store.egressPolicies.create({
      id: 'e2',
      name: 'Disabled',
      rule_type: 'allow',
      target_type: 'domain',
      target_value: 'y.test',
      priority: 20,
    });
    await store.egressPolicies.update('e2', { enabled: false });

    const enabled = await store.egressPolicies.listEnabled();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].id).toBe('e1');

    const all = await store.egressPolicies.list();
    expect(all).toHaveLength(2);
  });

  it('invalid URL is rejected with reason "Invalid URL"', async () => {
    const decision = await engine.evaluate('not a valid url');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('Invalid URL');
  });

  it('engine caches policies and reloads after invalidateCache', async () => {
    let loadCount = 0;
    const countingEngine = new EgressEngine(async () => {
      loadCount++;
      return store.egressPolicies.listEnabled();
    });

    await countingEngine.evaluate('https://allowed.example.com/');
    await countingEngine.evaluate('https://allowed.example.com/other');
    // Cache hit on second call
    expect(loadCount).toBe(1);

    countingEngine.invalidateCache();
    await countingEngine.evaluate('https://allowed.example.com/');
    expect(loadCount).toBe(2);
  });
});
