import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EgressEngine, type EgressPolicy } from '../../../packages/egress/src/engine';

// Mock the resolver so tests are deterministic (no real DNS, controllable region).
vi.mock('../../../packages/egress/src/resolver.js', () => ({
  resolveIP: (hostname: string): string => {
    // If it already looks like an IPv4 literal, return as-is.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;
    // Stub mapping for test hostnames → IPs.
    const map: Record<string, string> = {
      'api.example.com': '93.184.216.34',
      'sub.api.example.com': '93.184.216.35',
      'evil.test': '198.51.100.7',
      'internal.eu.example.com': '203.0.113.5',
    };
    return map[hostname] ?? hostname;
  },
  lookupRegion: (ip: string): string => {
    // Stub geo-IP mapping.
    if (ip.startsWith('203.0.113.')) return 'EU';
    if (ip.startsWith('93.184.')) return 'US';
    if (ip.startsWith('198.51.')) return 'RU';
    return '';
  },
}));

// Mock logger so tests don't spam.
vi.mock('@loop/observability', () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

function makePolicy(overrides: Partial<EgressPolicy> & Pick<EgressPolicy, 'id' | 'target_type' | 'target_value'>): EgressPolicy {
  return {
    name: overrides.id,
    rule_type: 'allow',
    priority: 10,
    enabled: true,
    ...overrides,
  };
}

describe('@loop/egress — EgressEngine', () => {
  let loader: ReturnType<typeof vi.fn>;
  let engine: EgressEngine;

  beforeEach(() => {
    loader = vi.fn();
    engine = new EgressEngine(loader);
  });

  describe('domain matching', () => {
    it('exact domain match allows the request', async () => {
      loader.mockResolvedValue([
        makePolicy({ id: 'p1', rule_type: 'allow', target_type: 'domain', target_value: 'api.example.com', priority: 10 }),
      ]);
      const decision = await engine.evaluate('https://api.example.com/v1/data');
      expect(decision.allowed).toBe(true);
      expect(decision.matched_policy).toBe('p1');
    });

    it('exact domain does NOT match a subdomain', async () => {
      loader.mockResolvedValue([
        makePolicy({ id: 'p1', rule_type: 'allow', target_type: 'domain', target_value: 'api.example.com', priority: 10 }),
      ]);
      const decision = await engine.evaluate('https://sub.api.example.com/x');
      expect(decision.allowed).toBe(false);
    });

    it('wildcard domain (*.example.com) matches any subdomain', async () => {
      loader.mockResolvedValue([
        makePolicy({ id: 'wc', rule_type: 'allow', target_type: 'domain', target_value: '*.example.com', priority: 10 }),
      ]);
      const decision = await engine.evaluate('https://api.example.com/x');
      expect(decision.allowed).toBe(true);
      expect(decision.matched_policy).toBe('wc');
    });

    it('wildcard *.example.com also matches deeper subdomains', async () => {
      loader.mockResolvedValue([
        makePolicy({ id: 'wc', rule_type: 'allow', target_type: 'domain', target_value: '*.example.com', priority: 10 }),
      ]);
      const decision = await engine.evaluate('https://sub.api.example.com/x');
      expect(decision.allowed).toBe(true);
    });
  });

  describe('IP CIDR matching', () => {
    it('allows IP within the permitted CIDR range', async () => {
      loader.mockResolvedValue([
        makePolicy({ id: 'cidr', rule_type: 'allow', target_type: 'ip_range', target_value: '93.184.216.0/24', priority: 10 }),
      ]);
      const decision = await engine.evaluate('https://api.example.com/');
      expect(decision.allowed).toBe(true);
      expect(decision.matched_policy).toBe('cidr');
    });

    it('denies IP outside the permitted CIDR range (default deny)', async () => {
      loader.mockResolvedValue([
        makePolicy({ id: 'cidr', rule_type: 'allow', target_type: 'ip_range', target_value: '10.0.0.0/8', priority: 10 }),
      ]);
      const decision = await engine.evaluate('https://api.example.com/');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toMatch(/default deny/i);
    });

    it('handles /32 (single-host) CIDR', async () => {
      loader.mockResolvedValue([
        makePolicy({ id: 'host', rule_type: 'allow', target_type: 'ip_range', target_value: '93.184.216.34/32', priority: 10 }),
      ]);
      const allow = await engine.evaluate('https://api.example.com/');
      expect(allow.allowed).toBe(true);

      engine.invalidateCache();
      loader.mockResolvedValue([
        makePolicy({ id: 'host', rule_type: 'allow', target_type: 'ip_range', target_value: '93.184.216.35/32', priority: 10 }),
      ]);
      const deny = await engine.evaluate('https://api.example.com/');
      expect(deny.allowed).toBe(false);
    });
  });

  describe('region matching', () => {
    it('allows when region matches the policy', async () => {
      loader.mockResolvedValue([
        makePolicy({ id: 'eu', rule_type: 'allow', target_type: 'region', target_value: 'US', priority: 10 }),
      ]);
      const decision = await engine.evaluate('https://api.example.com/');
      expect(decision.allowed).toBe(true);
      expect(decision.matched_policy).toBe('eu');
    });

    it('denies when region does not match (default deny)', async () => {
      loader.mockResolvedValue([
        makePolicy({ id: 'eu', rule_type: 'allow', target_type: 'region', target_value: 'EU', priority: 10 }),
      ]);
      const decision = await engine.evaluate('https://api.example.com/');
      expect(decision.allowed).toBe(false);
    });
  });

  describe('priority ordering', () => {
    it('higher-priority policy wins over lower-priority policy', async () => {
      loader.mockResolvedValue([
        makePolicy({ id: 'low', rule_type: 'deny', target_type: 'domain', target_value: 'api.example.com', priority: 10 }),
        makePolicy({ id: 'high', rule_type: 'allow', target_type: 'domain', target_value: 'api.example.com', priority: 100 }),
      ]);
      const decision = await engine.evaluate('https://api.example.com/');
      expect(decision.allowed).toBe(true);
      expect(decision.matched_policy).toBe('high');
    });

    it('high-priority deny overrides lower-priority allow', async () => {
      loader.mockResolvedValue([
        makePolicy({ id: 'low', rule_type: 'allow', target_type: 'domain', target_value: 'api.example.com', priority: 10 }),
        makePolicy({ id: 'high', rule_type: 'deny', target_type: 'domain', target_value: 'api.example.com', priority: 100 }),
      ]);
      const decision = await engine.evaluate('https://api.example.com/');
      expect(decision.allowed).toBe(false);
      expect(decision.matched_policy).toBe('high');
    });
  });

  describe('default deny', () => {
    it('denies when no policy matches', async () => {
      loader.mockResolvedValue([
        makePolicy({ id: 'p1', rule_type: 'allow', target_type: 'domain', target_value: 'other.example.com', priority: 10 }),
      ]);
      const decision = await engine.evaluate('https://api.example.com/');
      expect(decision.allowed).toBe(false);
      expect(decision.matched_policy).toBeNull();
      expect(decision.reason).toMatch(/default deny/i);
    });

    it('denies when there are no policies at all', async () => {
      loader.mockResolvedValue([]);
      const decision = await engine.evaluate('https://api.example.com/');
      expect(decision.allowed).toBe(false);
    });

    it('rejects malformed URLs', async () => {
      loader.mockResolvedValue([]);
      const decision = await engine.evaluate('not-a-url');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toMatch(/invalid url/i);
    });
  });

  describe('disabled policies', () => {
    it('skips disabled policies even when they would match', async () => {
      loader.mockResolvedValue([
        makePolicy({
          id: 'disabled-allow',
          rule_type: 'allow',
          target_type: 'domain',
          target_value: 'api.example.com',
          priority: 100,
          enabled: false,
        }),
      ]);
      const decision = await engine.evaluate('https://api.example.com/');
      expect(decision.allowed).toBe(false);
      expect(decision.matched_policy).toBeNull();
    });

    it('falls through to the next enabled policy when the top one is disabled', async () => {
      loader.mockResolvedValue([
        makePolicy({
          id: 'disabled',
          rule_type: 'deny',
          target_type: 'domain',
          target_value: 'api.example.com',
          priority: 100,
          enabled: false,
        }),
        makePolicy({
          id: 'enabled',
          rule_type: 'allow',
          target_type: 'domain',
          target_value: 'api.example.com',
          priority: 10,
          enabled: true,
        }),
      ]);
      const decision = await engine.evaluate('https://api.example.com/');
      expect(decision.allowed).toBe(true);
      expect(decision.matched_policy).toBe('enabled');
    });
  });

  describe('caching', () => {
    it('caches policies across evaluations within TTL', async () => {
      loader.mockResolvedValue([
        makePolicy({ id: 'p1', rule_type: 'allow', target_type: 'domain', target_value: 'api.example.com', priority: 10 }),
      ]);
      await engine.evaluate('https://api.example.com/a');
      await engine.evaluate('https://api.example.com/b');
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('invalidateCache forces a refetch', async () => {
      loader.mockResolvedValue([
        makePolicy({ id: 'p1', rule_type: 'allow', target_type: 'domain', target_value: 'api.example.com', priority: 10 }),
      ]);
      await engine.evaluate('https://api.example.com/a');
      engine.invalidateCache();
      await engine.evaluate('https://api.example.com/b');
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });
});
