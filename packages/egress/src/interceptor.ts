/**
 * Network call interceptor — wraps undici to enforce egress policies.
 */

import { request as undiciRequest, type Dispatcher } from 'undici';
import { lookup } from 'node:dns';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { createLogger } from '@loop/observability';
import type { EgressEngine } from './engine.js';
import { LoopError } from '@loop/types';

const logger = createLogger({ name: 'loop:egress:interceptor', component: 'egress' });

const lookupAll: (hostname: string, opts: { all: true }) => Promise<Array<{ address: string; family: number }>> =
  promisify(lookup) as unknown as typeof lookupAll;

/** IPv4 private / reserved ranges (CIDR first-address + mask bits). */
const PRIVATE_V4_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (incl. cloud metadata 169.254.169.254)
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved / broadcast
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.');
  // eslint-disable-next-line no-bitwise
  return ((Number(parts[0]) << 24) | (Number(parts[1]) << 16) | (Number(parts[2]) << 8) | Number(parts[3])) >>> 0;
}

function ipv4InCidr(ip: string, cidrBase: string, prefixBits: number): boolean {
  if (prefixBits === 0) return true;
  // eslint-disable-next-line no-bitwise
  const mask = prefixBits >= 32 ? 0xffffffff : (0xffffffff << (32 - prefixBits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(cidrBase) & mask);
}

/** True for loopback/private/reserved IPv4 addresses (RFC1918, CGNAT, link-local, …). */
export function isPrivateIPv4(ip: string): boolean {
  return PRIVATE_V4_RANGES.some(([base, bits]) => ipv4InCidr(ip, base, bits));
}

/** True for loopback/ULA/link-local/unspecified/v4-mapped-private IPv6 addresses. */
export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === '::1' || normalized === '::') return true;
  // v4-mapped (::ffff:a.b.c.d) — evaluate the embedded IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isPrivateIPv4(mapped[1]!);
  const first = normalized.split(':')[0] ?? '';
  if (first.length === 0) return false;
  // fc00::/7 unique-local and fe80::/10 link-local by leading 16 bits.
  const high16 = Number.parseInt(first.padEnd(4, '0'), 16);
  if (Number.isFinite(high16)) {
    // eslint-disable-next-line no-bitwise
    if (((high16 & 0xfe00) >>> 0) === 0xfc00) return true;
    // eslint-disable-next-line no-bitwise
    if (((high16 & 0xffc0) >>> 0) === 0xfe80) return true;
  }
  return false;
}

/** True when the literal IP string is a private/reserved address (v4 or v6). */
export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return false;
}

/**
 * Resolve a URL's host and return the first private/reserved address it would
 * reach, or null. Literal IPs are checked directly; hostnames are resolved via
 * DNS with `all: true` so an answer mixing public and private records is still
 * caught. DNS failure returns null (the request itself will fail downstream).
 */
export async function firstPrivateAddress(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) return isPrivateIp(host) ? host : null;
  try {
    const records = await lookupAll(host, { all: true });
    for (const record of records) {
      if (isPrivateIp(record.address)) return record.address;
    }
  } catch {
    return null;
  }
  return null;
}

export class EgressInterceptor {
  constructor(private engine: EgressEngine) {}

  /** Make an HTTP request that is subject to egress policy. */
  async request(url: string, opts?: Dispatcher.RequestOptions) {
    const decision = await this.engine.evaluate(url);
    if (!decision.allowed) {
      logger.warn({ url, reason: decision.reason }, 'Egress blocked');
      throw new LoopError('NODE_EGRESS_BLOCKED', `Egress blocked: ${decision.reason}`, 403);
    }
    return undiciRequest(url, opts);
  }
}

/** Options controlling when the gate enforces policy evaluation. */
export interface EgressGateOptions {
  /** Kill switch — when true, every outbound call is blocked (fail closed). */
  airgap: boolean;
  /**
   * Decision applied when no egress policies are configured at all. `allow`
   * keeps a fresh deployment usable (the product's whole point is calling the
   * ODW agents over HTTP); set to `deny` (or add a policy) to lock down.
   */
  unconfiguredPolicy: 'allow' | 'deny';
  /**
   * V1.7 (SSRF hardening): when false (default), private/reserved targets
   * (loopback, RFC1918, CGNAT, link-local incl. cloud metadata endpoints) are
   * rejected UNCONDITIONALLY — before the unconfigured-policy short-circuit
   * and regardless of any allow policy, so a `generic.rest_call` node cannot
   * be pointed at `169.254.169.254` or the API's own loopback listener.
   * Self-hosted suites that legitimately target sibling services on a private
   * network set this to true explicitly.
   */
  allowPrivate?: boolean;
}

/**
 * The single choke point every outbound connector call must pass through.
 *
 * Historically `EgressEngine`/`EgressInterceptor` existed but were never wired
 * into the execution path, so `LOOP_AIRGAP_MODE` and every egress policy were
 * dead config — any workflow node could reach arbitrary hosts (SSRF). Adapters
 * receive the gate via `ExecuteParams.egress` and must `check(url)` before
 * dispatching.
 */
export class EgressGate {
  constructor(
    private engine: EgressEngine,
    private opts: EgressGateOptions,
  ) {}

  /** Throw a 403 `NODE_EGRESS_BLOCKED` error when the URL may not be reached. */
  async check(url: string): Promise<void> {
    if (this.opts.airgap) {
      logger.warn({ url }, 'Egress blocked (airgap mode)');
      throw new LoopError('NODE_EGRESS_BLOCKED', 'Airgap mode is enabled — all outbound network calls are blocked', 403);
    }
    // V1.7 (SSRF hardening): the private-range blocklist applies even when no
    // policy is configured (and even when an allow policy matches) — it was
    // previously possible to reach 169.254.169.254 / 127.0.0.1 / RFC1918 via
    // the unconfigured `allow` short-circuit below.
    if (!this.opts.allowPrivate) {
      const privateAddr = await firstPrivateAddress(url);
      if (privateAddr !== null) {
        logger.warn({ url, address: privateAddr }, 'Egress blocked (private/reserved address)');
        throw new LoopError(
          'NODE_EGRESS_BLOCKED',
          `Egress blocked: '${privateAddr}' is a private/reserved address (set LOOP_EGRESS_ALLOW_PRIVATE=true only on trusted private networks)`,
          403,
        );
      }
    }
    if (!(await this.engine.isConfigured())) {
      if (this.opts.unconfiguredPolicy === 'deny') {
        logger.warn({ url }, 'Egress blocked (no policies configured, default deny)');
        throw new LoopError('NODE_EGRESS_BLOCKED', 'Egress blocked: no egress policies configured and the default policy is deny', 403);
      }
      return;
    }
    const decision = await this.engine.evaluate(url);
    if (!decision.allowed) {
      logger.warn({ url, reason: decision.reason }, 'Egress blocked');
      throw new LoopError('NODE_EGRESS_BLOCKED', `Egress blocked: ${decision.reason}`, 403);
    }
  }
}
