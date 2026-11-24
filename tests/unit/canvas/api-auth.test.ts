/**
 * Unit tests — canvas REST client auth wiring (audit #1).
 *
 * The SPA must attach the stored bearer token to every REST call (so an
 * auth-enabled API is usable), omit the header when no token exists (so
 * auth-disabled deployments are unchanged), and clear the session + redirect
 * to /login on 401.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { api } from '../../../apps/canvas/src/lib/api';

function stubStorage(token: string | null) {
  const store = new Map<string, string>();
  if (token !== null) store.set('loop.token', token);
  const localStorage = {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void store.set(k, v)),
    removeItem: vi.fn((k: string) => void store.delete(k)),
  };
  vi.stubGlobal('localStorage', localStorage);
  return localStorage;
}

function stubFetch(response: { status: number; ok: boolean; body: unknown }) {
  const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) => ({
    status: response.status,
    ok: response.ok,
    statusText: 'stub',
    json: async () => response.body,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('canvas REST auth (audit #1)', () => {
  it('attaches Authorization: Bearer when a token is stored', async () => {
    stubStorage('tok-123');
    const fetchMock = stubFetch({ status: 200, ok: true, body: { success: true, data: [], meta: { total: 0 } } });
    await api.listWorkflows();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-123');
  });

  it('omits Authorization when no token is stored (auth-disabled deployments)', async () => {
    stubStorage(null);
    const fetchMock = stubFetch({ status: 200, ok: true, body: { success: true, data: [], meta: { total: 0 } } });
    await api.listWorkflows();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('clears the token and redirects to /login on 401', async () => {
    const storage = stubStorage('expired-tok');
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    stubFetch({ status: 401, ok: false, body: { success: false, error: { code: 'AUTH_INVALID_TOKEN', message: 'expired' } } });
    await expect(api.listWorkflows()).rejects.toThrow(/log in/i);
    expect(storage.removeItem).toHaveBeenCalledWith('loop.token');
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('does not redirect-loop on a failed login request itself', async () => {
    stubStorage(null);
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    stubFetch({ status: 401, ok: false, body: { success: false, error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'bad credentials' } } });
    await expect(api.login('alice', 'wrong')).rejects.toThrow(/bad credentials/);
    expect(assign).not.toHaveBeenCalled();
  });
});
