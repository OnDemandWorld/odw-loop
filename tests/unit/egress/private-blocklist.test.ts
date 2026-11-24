/**
 * Unit tests — V1.7 egress private-address blocklist (L-3).
 *
 * The blocklist must hold even when no egress policy is configured (the
 * `unconfiguredPolicy: 'allow'` short-circuit) and regardless of allow
 * policies — closing the generic-connector SSRF path to loopback services
 * and cloud metadata endpoints.
 */

import { describe, it, expect, vi } from 'vitest';
import { EgressGate, isPrivateIp, firstPrivateAddress } from '../../../packages/egress/src/interceptor';
import type { EgressEngine } from '../../../packages/egress/src/engine';

// Audit #147: deterministic DNS — the public-hostname assertions previously
// did real lookups and passed vacuously when DNS failed (fail-open looked
// identical to 'resolved public'). Handles both (host, cb) and (host, opts, cb)
// call shapes and the {all:true} array form.
vi.mock('node:dns', () => ({
  lookup: (hostname: string, optsOrCb: unknown, maybeCb?: (err: Error | null, address?: unknown) => void) => {
    const opts = typeof optsOrCb === 'function' ? {} : (optsOrCb as { all?: boolean });
    const cb = (typeof optsOrCb === 'function' ? optsOrCb : maybeCb) as (err: Error | null, address?: unknown) => void;
    const answers: Record<string, Array<{ address: string; family: number }>> = {
      localhost: [
        { address: '127.0.0.1', family: 4 },
        { address: '::1', family: 6 },
      ],
      'example.com': [{ address: '93.184.216.34', family: 4 }],
      'private.example.com': [{ address: '10.0.0.5', family: 4 }],
    };
    const records = answers[hostname];
    if (!records) {
      cb(new Error('NXDOMAIN'));
      return;
    }
    cb(null, opts.all ? records : records[0]!.address);
  },
}));

const unconfiguredEngine = {
  async isConfigured() {
    return false;
  },
} as unknown as EgressEngine;

function gate(allowPrivate = false): EgressGate {
  return new EgressGate(unconfiguredEngine, {
    airgap: false,
    unconfiguredPolicy: 'allow',
    allowPrivate,
  });
}

describe('isPrivateIp', () => {
  it('classifies private/reserved IPv4 ranges', () => {
    for (const ip of ['0.0.0.1', '10.1.2.3', '100.64.0.5', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '224.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('classifies public IPv4 as not private', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '93.184.216.34']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('classifies IPv6 loopback/ULA/link-local/v4-mapped', () => {
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('::')).toBe(true);
    expect(isPrivateIp('fc00::1')).toBe(true);
    expect(isPrivateIp('fd12:3456::1')).toBe(true);
    expect(isPrivateIp('fe80::1')).toBe(true);
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
    expect(isPrivateIp('2606:4700::1111')).toBe(false);
  });

  it('audit #7: classifies non-canonical IPv6 spellings (expanded loopback, hex v4-mapped)', () => {
    for (const ip of [
      '0:0:0:0:0:0:0:1',
      '0000:0000:0000:0000:0000:0000:0000:0001',
      '::ffff:7f00:1',
      '0:0:0:0:0:ffff:a9fe:a9fe',
      'fe80:0:0:0:0:0:0:1',
      'fc00:0:0:0:0:0:0:1',
      '0:0:0:0:0:0:0:0',
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ['2001:db8:0:0:0:0:0:1', '0:0:0:0:0:ffff:0808:0808', '2606:4700:0:0:0:0:0:1111']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe('firstPrivateAddress', () => {
  it('detects literal private hosts in URLs', async () => {
    expect(await firstPrivateAddress('http://127.0.0.1:3000/api/v1/workflows')).toBe('127.0.0.1');
    expect(await firstPrivateAddress('http://169.254.169.254/latest/meta-data/')).toBe('169.254.169.254');
    expect(await firstPrivateAddress('http://[::1]:3000/')).toBe('::1');
  });

  it('returns null for public literal hosts', async () => {
    expect(await firstPrivateAddress('https://example.com/path')).toBeNull();
    expect(await firstPrivateAddress('https://1.1.1.1/dns-query')).toBeNull();
  });
});

describe('EgressGate private blocklist (unconfigured allow)', () => {
  it('blocks loopback and metadata targets even with unconfiguredPolicy allow', async () => {
    const g = gate();
    await expect(g.check('http://127.0.0.1:9200/_search')).rejects.toThrow(/private\/reserved/);
    await expect(g.check('http://169.254.169.254/latest/meta-data/iam/')).rejects.toThrow(/private\/reserved/);
    await expect(g.check('http://10.0.0.5:8080/admin')).rejects.toThrow(/private\/reserved/);
  });

  it('allows public targets under the unconfigured allow policy', async () => {
    const g = gate();
    await expect(g.check('https://example.com/')).resolves.toBeUndefined();
  });

  it('honours the explicit allowPrivate escape hatch for self-hosted suites', async () => {
    const g = gate(true);
    await expect(g.check('http://127.0.0.1:8765/query')).resolves.toBeUndefined();
    await expect(g.check('http://192.168.1.10:8000/health')).resolves.toBeUndefined();
  });

  it('blocks localhost hostnames that resolve to loopback', async () => {
    const g = gate();
    // `localhost` resolves to 127.0.0.1/::1 on every supported platform.
    await expect(g.check('http://localhost:8765/query')).rejects.toThrow(/private\/reserved/);
  });

  it('audit #7: blocks non-canonical IPv6 loopback/v4-mapped URLs', async () => {
    const g = gate();
    await expect(g.check('http://[0:0:0:0:0:0:0:1]:3000/')).rejects.toThrow(/private\/reserved/);
    await expect(g.check('http://[::ffff:7f00:1]:3000/')).rejects.toThrow(/private\/reserved/);
    await expect(g.check('http://[0:0:0:0:0:ffff:a9fe:a9fe]/latest/meta-data/')).rejects.toThrow(/private\/reserved/);
  });
});

describe('EgressGate dispatcher — connect-time validation (audit #8)', () => {
  it('rejects private targets at CONNECT time even without a prior check()', async () => {
    const http = await import('node:http');
    const { request } = await import('undici');
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const g = gate(false); // allowPrivate=false
      // No gate.check() call — the dispatcher's lookup hook must still block
      // the loopback connection (DNS-rebinding defense). Use a HOSTNAME:
      // undici skips the lookup hook for IP literals (those are covered by
      // check()'s literal path); the rebinding window is hostname resolution.
      await expect(
        request(`http://localhost:${port}/`, { dispatcher: g.dispatcher }),
      ).rejects.toThrow(/private\/reserved/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('allows the connection when allowPrivate is set', async () => {
    const http = await import('node:http');
    const { request } = await import('undici');
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const g = gate(true);
      const res = await request(`http://127.0.0.1:${port}/`, { dispatcher: g.dispatcher });
      expect(res.statusCode).toBe(200);
      await res.body.text();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
