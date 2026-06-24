/**
 * DNS resolution + IP geolocation for egress policy evaluation.
 */

import { lookup } from 'node:dns';

/** Synchronous DNS resolution (best-effort, returns hostname if DNS fails). */
export function resolveIP(hostname: string): string {
  // Synchronous DNS lookup — in production this would use a cache
  try {
    let result = hostname;
    lookup(hostname, { family: 4 }, (err, address) => {
      if (!err) result = address;
    });
    return result;
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
