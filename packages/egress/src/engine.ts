/**
 * Egress policy engine — evaluates policies in priority order (§6.4).
 * Default: deny (secure by default).
 */

import { createLogger } from '@loop/observability';
import { resolveIP, lookupRegion } from './resolver.js';

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

    const hostname = parsed.hostname;
    const ip = resolveIP(hostname);
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

  private async getPolicies(): Promise<EgressPolicy[]> {
    if (this.cache && Date.now() - this.cache.fetchedAt < this.CACHE_TTL) {
      return this.cache.policies;
    }
    const policies = await this.policyLoader();
    this.cache = { policies, fetchedAt: Date.now() };
    return policies;
  }
}

/** Domain matching with wildcard support (*.example.com). */
function matchDomain(hostname: string, pattern: string): boolean {
  if (pattern === hostname) return true;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return hostname.endsWith(suffix) || hostname === suffix;
  }
  return false;
}

/** Check if an IP is within a CIDR range. */
function ipInCIDR(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  if (!range || !bitsStr) return false;
  const bits = parseInt(bitsStr, 10);

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
