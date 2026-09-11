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
  lookup: (hostname: string, _opts: unknown, cb: (err: Error | null, address?: string) => void) => {
    // "Resolve" only our test domain; anything else fails like real DNS.
    if (hostname === 'api.example.com') cb(null, '93.184.216.34');
    else cb(new Error('NXDOMAIN'));
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
