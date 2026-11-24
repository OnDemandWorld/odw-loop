/**
 * Regression tests for the egress wiring (S1) and hardening fixes (M7):
 *
 * - EgressGate: airgap mode blocks everything; with no policies configured the
 *   unconfigured policy decides; configured policies evaluate default-deny.
 * - matchDomain: `*.example.com` must not match `evilexample.com` (label
 *   boundary).
 * - resolveIP is async now (the old synchronous wrapper never awaited DNS, so
 *   ip_range policies silently never matched).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EgressEngine, type EgressPolicy } from '../../../packages/egress/src/engine';
import { EgressGate } from '../../../packages/egress/src/interceptor';
import { resolveIP } from '../../../packages/egress/src/resolver';

vi.mock('@loop/observability', () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

vi.mock('node:dns', () => ({
  // Audit #80: honour opts.all — the interceptor calls lookup with {all:true},
  // which really returns an ARRAY of {address,family}. The old string-only
  // mock made firstPrivateAddress iterate characters and silently no-op the
  // hostname private-address branch.
  lookup: (hostname: string, optsOrCb: unknown, maybeCb?: (err: Error | null, address?: unknown) => void) => {
    // dns.lookup is called both as (host, cb) and (host, opts, cb).
    const opts = typeof optsOrCb === 'function' ? {} : optsOrCb;
    const cb = (typeof optsOrCb === 'function' ? optsOrCb : maybeCb) as (err: Error | null, address?: unknown) => void;
    const all = typeof opts === 'object' && opts !== null && (opts as { all?: boolean }).all === true;
    if (hostname === 'api.example.com') {
      cb(null, all ? [{ address: '93.184.216.34', family: 4 }] : '93.184.216.34');
    } else if (hostname === 'private.example.com') {
      cb(null, all ? [{ address: '10.0.0.5', family: 4 }] : '10.0.0.5');
    } else {
      cb(new Error('NXDOMAIN'));
    }
  },
}));

const noPolicies = async (): Promise<EgressPolicy[]> => [];

describe('resolveIP (async DNS)', () => {
  it('resolves a hostname to an address', async () => {
    await expect(resolveIP('api.example.com')).resolves.toBe('93.184.216.34');
  });

  it('falls back to the hostname when DNS fails', async () => {
    await expect(resolveIP('nonexistent.invalid')).resolves.toBe('nonexistent.invalid');
  });
});

describe('EgressEngine domain matching (M7 label boundary)', () => {
  it('does not match an attacker domain that merely ends with the suffix', async () => {
    const engine = new EgressEngine(async () => [
      { id: 'p1', name: 'allow example', rule_type: 'allow', target_type: 'domain', target_value: '*.example.com', priority: 10, enabled: true },
    ]);
    // Subdomain → allowed.
    await expect(engine.evaluate('https://a.example.com/x')).resolves.toMatchObject({ allowed: true });
    // evilexample.com ends with "example.com" but is a different label → denied.
    await expect(engine.evaluate('https://evilexample.com/x')).resolves.toMatchObject({ allowed: false });
  });
});

describe('EgressGate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks every call in airgap mode (even with an allow policy)', async () => {
    const engine = new EgressEngine(async () => [
      { id: 'p1', name: 'allow all', rule_type: 'allow', target_type: 'domain', target_value: '*', priority: 10, enabled: true },
    ]);
    const gate = new EgressGate(engine, { airgap: true, unconfiguredPolicy: 'allow' });
    await expect(gate.check('https://api.example.com')).rejects.toMatchObject({ code: 'NODE_EGRESS_BLOCKED' });
  });

  it('allows calls when no policies exist and unconfiguredPolicy is allow', async () => {
    const gate = new EgressGate(new EgressEngine(noPolicies), { airgap: false, unconfiguredPolicy: 'allow' });
    await expect(gate.check('https://anything.test')).resolves.toBeUndefined();
  });

  it('blocks calls when no policies exist and unconfiguredPolicy is deny', async () => {
    const gate = new EgressGate(new EgressEngine(noPolicies), { airgap: false, unconfiguredPolicy: 'deny' });
    await expect(gate.check('https://anything.test')).rejects.toMatchObject({ code: 'NODE_EGRESS_BLOCKED' });
  });

  it('enforces default-deny against configured policies', async () => {
    const engine = new EgressEngine(async () => [
      { id: 'p1', name: 'allow example', rule_type: 'allow', target_type: 'domain', target_value: 'api.example.com', priority: 10, enabled: true },
    ]);
    const gate = new EgressGate(engine, { airgap: false, unconfiguredPolicy: 'allow' });
    await expect(gate.check('https://api.example.com/x')).resolves.toBeUndefined();
    await expect(gate.check('https://other.test/x')).rejects.toMatchObject({ code: 'NODE_EGRESS_BLOCKED' });
  });
});

describe('EgressGate — hostname private-address resolution (audit #80)', () => {
  it('blocks hostnames that resolve to private addresses even under an allow policy', async () => {
    const engine = new EgressEngine(async () => [
      { id: 'p1', name: 'allow all', rule_type: 'allow', target_type: 'domain', target_value: '*', priority: 10, enabled: true },
    ]);
    const gate = new EgressGate(engine, { airgap: false, unconfiguredPolicy: 'allow' });
    await expect(gate.check('http://private.example.com/')).rejects.toThrow(/private\/reserved/);
  });
});
