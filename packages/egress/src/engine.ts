/**
 * Egress policy engine — evaluates policies in priority order (§6.4).
 * Default: deny (secure by default).
 */

import { createLogger } from '@loop/observability';
import { resolveIP, lookupRegion, parseIPv6Bytes } from './resolver.js';

const logger = createLogger({ name: 'loop:egress:engine', component: 'egress' });

export interface EgressPolicy {
  id: string;
  name: string;
  rule_type: 'allow' | 'deny';
  target_type: 'domain' | 'ip_range' | 'region';
  target_value: string;
  priority: number;
  enabled: boolean;
}

export interface EgressDecision {
  allowed: boolean;
  matched_policy: string | null;
  reason: string;
}

export class EgressEngine {
  private cache: { policies: EgressPolicy[]; fetchedAt: number } | null = null;
  private readonly CACHE_TTL = 60_000;
  private policyLoader: () => Promise<EgressPolicy[]>;

  constructor(policyLoader: () => Promise<EgressPolicy[]>) {
    this.policyLoader = policyLoader;
  }

  /** Evaluate whether a URL is allowed. */
  async evaluate(url: string): Promise<EgressDecision> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, matched_policy: null, reason: 'Invalid URL' };
    }

    // Strip IPv6 brackets — URL.hostname keeps them on some Node versions,
    // which broke ip_range matching and DNS resolution for IPv6 literals.
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    const ip = await resolveIP(hostname);
    const region = lookupRegion(ip);

    const policies = await this.getPolicies();
    const sorted = [...policies].sort((a, b) => b.priority - a.priority);

    for (const policy of sorted) {
      if (!policy.enabled) continue;

      let matches = false;
      switch (policy.target_type) {
        case 'domain':
          matches = matchDomain(hostname, policy.target_value);
          break;
        case 'ip_range':
          matches = ipInCIDR(ip, policy.target_value);
          break;
        case 'region':
          matches = region === policy.target_value;
          break;
      }

      if (matches) {
        const allowed = policy.rule_type === 'allow';
        logger.debug({ url, policy: policy.name, allowed }, 'Egress policy matched');
        return {
          allowed,
          matched_policy: policy.id,
          reason: `Matched policy: ${policy.name}`,
        };
      }
    }

    // Default: deny
    return { allowed: false, matched_policy: null, reason: 'No matching allow policy (default deny)' };
  }

  /** Invalidate the policy cache (called when policies change). */
  invalidateCache(): void {
    this.cache = null;
  }

  /** True when at least one enabled egress policy is configured. */
  async isConfigured(): Promise<boolean> {
    const policies = await this.getPolicies();
    return policies.length > 0;
  }

  private async getPolicies(): Promise<EgressPolicy[]> {
    if (this.cache && Date.now() - this.cache.fetchedAt < this.CACHE_TTL) {
      return this.cache.policies;
    }
    const policies = await this.policyLoader();
    this.cache = { policies, fetchedAt: Date.now() };
    return policies;
  }
}

/**
 * Domain matching with wildcard support (*.example.com). The wildcard only
 * matches at a label boundary — `*.example.com` must not match
 * `evilexample.com`, only `a.example.com` (or the bare domain).
 */
function matchDomain(hostname: string, pattern: string): boolean {
  const h = hostname.toLowerCase();
  const p = pattern.toLowerCase();
  if (p === h) return true;
  if (p.startsWith('*.')) {
    const suffix = p.slice(2);
    return h === suffix || h.endsWith(`.${suffix}`);
  }
  return false;
}

/** Check if an IP is within a CIDR range (IPv4 and IPv6 — audit #116). */
function ipInCIDR(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  if (!range || !bitsStr) return false;
  const bits = parseInt(bitsStr, 10);
  if (Number.isNaN(bits)) return false;

  // IPv6: compare the leading `bits` of the 128-bit addresses.
  if (ip.includes(':') || range.includes(':')) {
    const a = parseIPv6Bytes(ip);
    const b = parseIPv6Bytes(range);
    if (!a || !b || bits < 0 || bits > 128) return false;
    const toBig = (bytes: number[]): bigint => bytes.reduce((acc, x) => (acc << 8n) | BigInt(x), 0n);
    const shift = BigInt(128 - bits);
    return (toBig(a) >> shift) === (toBig(b) >> shift);
  }

  if (bits < 0 || bits > 32) return false;
  const ipNum = ipToNum(ip);
  const rangeNum = ipToNum(range);
  if (ipNum === null || rangeNum === null) return false;

  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) & 0xffffffff;
  return (ipNum & mask) === (rangeNum & mask);
}

function ipToNum(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) + n;
  }
  return num >>> 0;
}
