/**
 * Unit tests — V1.5 M1 (F-3, TR2) connector outbound trace propagation.
 *
 * The Vault/Desk/Recap adapters forward the active request's trace_id as an
 * `X-Trace-Id` header on their outbound HTTP calls (best-effort, read from the
 * AsyncLocalStorage correlation context). We intercept at the undici dispatcher
 * level with a MockAgent (no network, no module-mocking fragility) and capture
 * the exact outbound headers. The request/response contract is unchanged — only
 * an extra header is added (INTEGRATION_CONTRACT.md §4).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { VaultAdapter } from '../../../packages/connectors/src/vault/adapter.js';
import { DeskAdapter } from '../../../packages/connectors/src/desk/adapter.js';
import { RecapAdapter } from '../../../packages/connectors/src/recap/adapter.js';
import { runWithCorrelation } from '../../../packages/observability/src/correlation.js';

const ORIGINS = ['http://localhost:8765', 'http://localhost:8000', 'http://localhost:8080'];

let agent: MockAgent;
let lastHeaders: Record<string, string>;
let originalDispatcher: Dispatcher;

/** Normalise the captured request headers (Headers instance or plain object) to a lowercase-keyed map. */
function normalizeHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw === undefined || raw === null) return out;
  if (typeof (raw as Headers).forEach === 'function') {
    (raw as Headers).forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  for (const [key, value] of Object.entries(raw as Record<string, string>)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

describe('Connector outbound X-Trace-Id forwarding (TR2)', () => {
  beforeAll(() => {
    // Remember the real dispatcher so we can restore it after this suite, keeping
    // the global undici dispatcher from leaking into other test files.
    originalDispatcher = getGlobalDispatcher();
  });

  afterAll(() => {
    setGlobalDispatcher(originalDispatcher);
  });

  beforeEach(() => {
    lastHeaders = {};
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    // Catch-all interceptors for every connector origin: capture the outbound
    // headers and reply 200 {} so the adapters' parsing path runs normally.
    for (const origin of ORIGINS) {
      agent
        .get(origin)
        .intercept({ path: /.*/, method: /.*/ })
        .reply((opts) => {
          lastHeaders = normalizeHeaders(opts.headers);
          return { statusCode: 200, data: {} };
        })
        .persist();
    }
  });

  afterEach(async () => {
    await agent.close();
  });

  it('Desk forwards the active trace_id as X-Trace-Id', async () => {
    const adapter = new DeskAdapter();
    await runWithCorrelation({ request_id: 'req-1', trace_id: 'trace-desk' }, () =>
      adapter.execute({ operation: 'list_conversations', input: {} }),
    );

    expect(lastHeaders['x-trace-id']).toBe('trace-desk');
  });

  it('Desk omits X-Trace-Id when no correlation context is active', async () => {
    const adapter = new DeskAdapter();
    await adapter.execute({ operation: 'list_conversations', input: {} });

    expect(lastHeaders).not.toHaveProperty('x-trace-id');
  });

  it('Recap forwards the active trace_id as X-Trace-Id', async () => {
    const adapter = new RecapAdapter();
    await runWithCorrelation({ request_id: 'req-2', trace_id: 'trace-recap' }, () =>
      adapter.execute({ operation: 'list_meetings', input: {}, config: { api_key: 'jwt-token' } }),
    );

    expect(lastHeaders['x-trace-id']).toBe('trace-recap');
  });

  it('Vault forwards the active trace_id as X-Trace-Id (callVault path)', async () => {
    const adapter = new VaultAdapter();
    await runWithCorrelation({ request_id: 'req-3', trace_id: 'trace-vault' }, () =>
      adapter.execute({ operation: 'get_document', input: { id: 'doc-1' } }),
    );

    expect(lastHeaders['x-trace-id']).toBe('trace-vault');
  });

  it('Vault omits X-Trace-Id when no correlation context is active', async () => {
    const adapter = new VaultAdapter();
    await adapter.execute({ operation: 'get_document', input: { id: 'doc-1' } });

    expect(lastHeaders).not.toHaveProperty('x-trace-id');
  });

  it('does not alter the business response shape', async () => {
    const adapter = new DeskAdapter();
    const result = await runWithCorrelation({ request_id: 'req-4', trace_id: 'trace-x' }, () =>
      adapter.execute({ operation: 'list_conversations', input: {} }),
    );

    expect(result).toEqual({ output: {} });
  });
});
