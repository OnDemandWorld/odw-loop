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
    // promisify(lookup) yields a plain address string under the default
    // wrapper and `{ address, family }` under dns.lookup's custom promisify —
    // accept both shapes.
    const result = (await lookupAsync(hostname, { family: 4 })) as string | { address?: string };
    const address = typeof result === 'string' ? result : result?.address;
    return address ?? hostname;
  } catch {
    return hostname;
  }
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
