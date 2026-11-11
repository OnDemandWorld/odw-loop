/**
 * Regression — IPv6 SSRF canonicalization (deep-review fix).
 *
 * A textual check only matched the dotted-quad v4-mapped form
 * (`::ffff:127.0.0.1`). The same loopback target written as hex hextets
 * (`::ffff:7f00:1`) or fully expanded (`0:0:0:0:0:ffff:127.0.0.1`) bypassed
 * the private-address blocklist. isPrivateIPv6 now canonicalizes to eight
 * 16-bit hextets before classifying, so every spelling of a private target
 * is caught.
 */

import { describe, it, expect } from 'vitest';
import { isPrivateIp, isPrivateIPv6, firstPrivateAddress } from '../../../packages/egress/src/interceptor';

describe('IPv6 v4-mapped loopback canonicalization (SSRF bypass regression)', () => {
  it('blocks every spelling of the v4-mapped loopback address', () => {
    for (const ip of [
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '0:0:0:0:0:ffff:127.0.0.1',
      '0:0:0:0:0:ffff:7f00:1',
      '::FFFF:7F00:1',
    ]) {
      expect(isPrivateIPv6(ip), ip).toBe(true);
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('blocks v4-mapped private ranges written as hex hextets', () => {
    expect(isPrivateIPv6('::ffff:a00:1')).toBe(true); // 10.0.0.1
    expect(isPrivateIPv6('::ffff:c0a8:1')).toBe(true); // 192.168.0.1
    expect(isPrivateIPv6('::ffff:a9fe:a9fe')).toBe(true); // 169.254.169.254 (cloud metadata)
  });

  it('allows v4-mapped public addresses in every spelling', () => {
    for (const ip of ['::ffff:8.8.8.8', '::ffff:808:808', '0:0:0:0:0:ffff:8.8.8.8']) {
      expect(isPrivateIPv6(ip), ip).toBe(false);
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('handles bracketed literals and zone indices', () => {
    expect(isPrivateIPv6('[::ffff:7f00:1]')).toBe(true);
    expect(isPrivateIPv6('[::1]')).toBe(true);
    expect(isPrivateIPv6('fe80::1%eth0')).toBe(true);
  });

  it('the gate catches a bracketed hex v4-mapped loopback URL', async () => {
    expect(await firstPrivateAddress('http://[::ffff:7f00:1]:80/')).toBe('::ffff:7f00:1');
    expect(await firstPrivateAddress('http://[::ffff:808:808]:80/')).toBeNull();
  });

  it('rejects malformed literals safely (no crash, classified not-private)', () => {
    for (const ip of ['gggg::1', '1:2:3:4:5:6:7:8:9', ':::', '12345::1', '']) {
      expect(isPrivateIPv6(ip), ip).toBe(false);
    }
  });

  it('still classifies native IPv6 private ranges', () => {
    expect(isPrivateIPv6('::1')).toBe(true);
    expect(isPrivateIPv6('::')).toBe(true);
    expect(isPrivateIPv6('fc00::1')).toBe(true);
    expect(isPrivateIPv6('fdff::1')).toBe(true);
    expect(isPrivateIPv6('fe80::1')).toBe(true);
    expect(isPrivateIPv6('2606:4700::1111')).toBe(false);
  });
});