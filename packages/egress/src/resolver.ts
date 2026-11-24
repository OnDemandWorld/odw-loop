/**
 * DNS resolution + IP geolocation for egress policy evaluation.
 */

import { lookup } from 'node:dns';
import { promisify } from 'node:util';

const lookupAsync = promisify(lookup);

/**
 * Resolve a hostname to an IPv4 address (best-effort — returns the hostname
 * itself when DNS fails). Async on purpose: the previous implementation
 * invoked the callback-based `lookup` but returned before it fired, so the
 * "resolved IP" was always the hostname and IP-range/region policies never
 * matched.
 */
export async function resolveIP(hostname: string): Promise<string> {
  try {
    // Audit #116: resolve BOTH families — forcing family:4 made ip_range
    // policies silently inapplicable to IPv6-only hosts. promisify(lookup)
    // yields a plain address string under the default wrapper and
    // `{ address, family }` under dns.lookup's custom promisify — accept both.
    const result = (await lookupAsync(hostname)) as string | { address?: string };
    const address = typeof result === 'string' ? result : result?.address;
    return address ?? hostname;
  } catch {
    return hostname;
  }
}

/**
 * Parse an IPv6 literal into 16 bytes, handling '::' compression and embedded
 * dotted-IPv4 tails. Returns null for anything malformed. Shared by the
 * private-address blocklist (interceptor) and IPv6 CIDR matching (engine).
 */
export function parseIPv6Bytes(ip: string): number[] | null {
  const halves = ip.split('::');
  if (halves.length > 2) return null;

  const expand = (segment: string): number[] | null => {
    if (segment === '') return [];
    const groups = segment.split(':');
    const bytes: number[] = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]!;
      if (g.includes('.')) {
        // Embedded IPv4 is only valid as the final group.
        if (i !== groups.length - 1) return null;
        const octets = g.split('.');
        if (octets.length !== 4) return null;
        for (const o of octets) {
          if (!/^\d{1,3}$/.test(o)) return null;
          const n = Number(o);
          if (n > 255) return null;
          bytes.push(n);
        }
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      const n = Number.parseInt(g, 16);
      bytes.push(n >> 8, n & 0xff);
    }
    return bytes;
  };

  const left = expand(halves[0]!);
  if (!left) return null;
  if (halves.length === 1) return left.length === 16 ? left : null;
  const right = expand(halves[1]!);
  if (!right) return null;
  const fill = 16 - left.length - right.length;
  if (fill < 1) return null; // '::' must stand for at least one zero group
  return [...left, ...new Array<number>(fill).fill(0), ...right];
}

/**
 * IP geolocation lookup (stub).
 * In production, use a GeoIP database (e.g., MaxMind).
 * Returns a region code or empty string.
 */
export function lookupRegion(_ip: string): string {
  // Stub: no GeoIP database available
  return '';
}
