/**
 * Regression tests — 2026-10 pre-launch deep review.
 *
 * Covers:
 *   1. Postgres workflows.delete runs BEGIN/COMMIT on a dedicated client
 *      (pool.query per statement = no transaction).
 *   2. Archived workflows: cron ticks skip, webhooks 404.
 *   3. Inline sub-workflow cycle detection (previously silent green no-op).
 *   4. Backoff sleep is abortable — no orphan retry loop after node timeout.
 *   5. Desk send_response carries content in the JSON body (long replies
 *      overflow query-string limits and leak into access logs).
 *   6. Generic adapter: non-JSON upstream → text output; >=400 → UpstreamError;
 *      path segments are encoded.
 *   7. Credential redaction on GET /connectors and trigger listing.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import { createHmac } from 'node:crypto';

import { PostgresStateStore } from '../../packages/state/src/postgres/index.js';
import type { PostgresConnection } from '../../packages/state/src/postgres/connection.js';
import { CronTriggerHandler } from '../../packages/triggers/src/cron';
import { WebhookTriggerHandler } from '../../packages/triggers/src/webhook';
import { executeWithRetry } from '../../packages/engine/src/retry';
import { ExecutionExecutor } from '../../packages/engine/src/executor';
import { ConnectorRegistry } from '../../packages/connectors/src';
import { DeskAdapter } from '../../packages/connectors/src/desk/adapter';
import { GenericAdapter } from '../../packages/connectors/src/generic/adapter';
import { createSqliteConnection, SqliteStateStore, type SqliteConnection } from '../../packages/state/src';
import {
  redactConnectorSecrets,
  redactTriggerSecrets,
} from '../../apps/api/src/routes/index';
import type { WorkflowDefinition } from '../../packages/types/src';

// ---------------------------------------------------------------------------
// 1. Postgres delete transaction
// ---------------------------------------------------------------------------

describe('Postgres workflows.delete — dedicated transaction client', () => {
  function mockPoolConn() {
    const poolClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'exec-1' }] }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn().mockResolvedValue(poolClient),
    };
    const conn = { pool, close: vi.fn() } as unknown as PostgresConnection;
    return { conn, pool, poolClient, store: new PostgresStateStore(conn) };
  }

  it('checks out one client for BEGIN..COMMIT and releases it', async () => {
    const { pool, poolClient, store } = mockPoolConn();
    await store.workflows.delete('wf-1');

    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(pool.query).not.toHaveBeenCalled();
    // All statements (SELECT + BEGIN + DELETEs + COMMIT) went to ONE client.
    const sqls = poolClient.query.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toContain('SELECT id FROM workflow_executions');
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('COMMIT');
    expect(poolClient.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and still releases when a DELETE fails', async () => {
    const { poolClient, store } = mockPoolConn();
    poolClient.query
      .mockResolvedValueOnce({ rows: [] }) // SELECT executions
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('FK violation'));
    await expect(store.workflows.delete('wf-1')).rejects.toThrow('FK violation');
    const sqls = poolClient.query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toContain('ROLLBACK');
    expect(poolClient.release).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Archived workflow triggers
// ---------------------------------------------------------------------------

describe('Archived workflows no longer trigger', () => {
  it('cron tick creates no execution for an archived workflow', async () => {
    const created: string[] = [];
    const store = {
      workflows: {
        getById: vi.fn().mockResolvedValue({ id: 'wf-1', version: 2, status: 'archived' }),
      },
      executions: {
        create: vi.fn().mockImplementation(async ({ id }: { id: string }) => {
          created.push(id);
        }),
        updateStatus: vi.fn().mockResolvedValue(undefined),
      },
    } as any;
    const handler = new CronTriggerHandler(store);
    handler.register('t-1', 'wf-1', { expression: '* * * * * *' }); // every second
    await new Promise((r) => setTimeout(r, 2200));
    handler.shutdown();
    expect(created).toEqual([]);
  });

  it('webhook handler 404s (NotFound) for an archived workflow', async () => {
    const triggerId = 'archived-webhook-trigger';
    const store = {
      triggers: {
        getById: vi.fn().mockResolvedValue({
          id: triggerId,
          workflow_id: 'wf-1',
          enabled: true,
          config: { secret: 's' },
        }),
      },
      workflows: {
        getById: vi.fn().mockResolvedValue({ id: 'wf-1', version: 1, status: 'archived' }),
      },
      executions: { create: vi.fn() },
    } as any;

    const handler = new WebhookTriggerHandler(store);
    const rawBody = JSON.stringify({ a: 1 });
    const signature = `sha256=${createHmac('sha256', 's').update(rawBody).digest('hex')}`;
    await expect(
      handler.handle({ triggerId, signature, body: { a: 1 }, rawBody }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(store.executions.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Inline sub-workflow cycle detection
// ---------------------------------------------------------------------------

describe('workflow.invoke — inline cycle detection', () => {
  it('fails the node with VALIDATION_INVALID instead of silently dropping cycle nodes', async () => {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    const store = new SqliteStateStore(conn);
    await store.initialise();
    await store.users.create({
      id: 'system', username: 'system', password_hash: '', email: 'system@loop.internal',
      role: 'admin', display_name: 'System',
    });

    // Cyclic inline child: A → B → A. computeLevels silently drops both.
    const cyclic: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'a', type: 'mock.op', position: { x: 0, y: 0 }, config: {} },
        { id: 'b', type: 'mock.op', position: { x: 100, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'a' },
      ],
      variables: {},
      metadata: { name: 'cyclic-child' },
    };
    const parent: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'node_sub', type: 'workflow.invoke', position: { x: 0, y: 0 }, config: { definition: cyclic } },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'parent' },
    };
    const workflowId = `wf-${crypto.randomUUID()}`;
    await store.workflows.create({
      id: workflowId, name: 'cyc', description: '', definition: parent, created_by: 'system',
    });
    const executionId = `exec-${crypto.randomUUID()}`;
    await store.executions.create({
      id: executionId, workflow_id: workflowId, workflow_version: 1,
      trigger_type: 'manual', trigger_payload: {},
    });

    const connectors = new ConnectorRegistry();
    const executor = new ExecutionExecutor(store, connectors, 5, 5_000);
    // The execution is marked failed AND the node error rethrows (fail-fast).
    await expect(executor.execute(executionId, parent, {})).rejects.toMatchObject({
      code: 'VALIDATION_INVALID',
    });

    const execution = await store.executions.getById(executionId);
    expect(execution?.status).toBe('failed');
    const nodeExecs = await store.nodeExecutions.listByExecution(executionId);
    const invokeRow = nodeExecs.find((n) => n.node_id === 'node_sub');
    expect(invokeRow?.status).toBe('failed');
    expect(String(invokeRow?.error)).toContain('cycle');
    conn.close();
  });
});

// ---------------------------------------------------------------------------
// 4. Abortable backoff
// ---------------------------------------------------------------------------

describe('executeWithRetry — abortable backoff', () => {
  it('stops retrying when the signal aborts during the backoff sleep', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      // First call fails; abort the deadline while we're backing off.
      if (calls === 1) controller.abort();
      throw new Error('upstream down');
    });
    const config = { max_attempts: 10, backoff: 'fixed' as const, initial_delay_ms: 5_000 };

    await expect(
      executeWithRetry(fn, config, undefined, controller.signal),
    ).rejects.toThrow('upstream down');
    // One failed call only — the 5s sleep was aborted instead of ticking.
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 5/6. Connector contract details
// ---------------------------------------------------------------------------

describe('Connector hardening', () => {
  const seen: { method?: string; url?: string; body: string }[] = [];
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, body });
        const url = req.url ?? '';
        if (url.startsWith('/plain')) {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<html>login page</html>');
          return;
        }
        if (url.startsWith('/error')) {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'unavailable' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('Desk send_response carries content in the JSON body, not the query', async () => {
    const adapter = new DeskAdapter();
    const content = 'x'.repeat(20_000); // way past URL limits
    await adapter.execute({
      operation: 'send_response',
      input: { id: 'conv-77', agent_id: 'agent-1', content },
      config: { base_url: `http://127.0.0.1:${port}` },
    } as never);

    const last = seen[seen.length - 1];
    expect(last.url).toContain('/api/v1/agents/conversations/conv-77/respond');
    expect(last.url).toContain('agent_id=agent-1');
    expect(last.url).not.toContain('content=');
    expect(JSON.parse(last.body)).toEqual({ content });
  });

  it('Generic adapter returns text for non-JSON upstreams instead of crashing', async () => {
    const adapter = new GenericAdapter();
    const result = await adapter.execute({
      operation: 'rest_call',
      input: { path: '/plain', method: 'GET', body: {} },
      config: { base_url: `http://127.0.0.1:${port}` },
    } as never);
    expect(result.output['status']).toBe(200);
    expect((result.output['data'] as Record<string, unknown>)['text']).toContain('<html>');
  });

  it('Generic adapter throws UpstreamError on >=400 (error body is not data)', async () => {
    const adapter = new GenericAdapter();
    await expect(
      adapter.execute({
        operation: 'rest_call',
        input: { path: '/error', method: 'GET', body: {} },
        config: { base_url: `http://127.0.0.1:${port}` },
      } as never),
    ).rejects.toMatchObject({ code: 'UPSTREAM_GENERIC_HTTP_ERROR' });
  });

  it('Generic adapter encodes path segments so "../" cannot escape', async () => {
    const adapter = new GenericAdapter();
    await adapter
      .execute({
        operation: 'rest_call',
        input: { path: '/files/../../../etc/passwd', method: 'GET', body: {} },
        config: { base_url: `http://127.0.0.1:${port}` },
      } as never)
      .catch(() => undefined);
    const last = seen[seen.length - 1];
    // The traversal must arrive percent-encoded, never as literal ../
    expect(last.url).not.toContain('../');
    expect(last.url).not.toContain('/etc/passwd');
  });
});

// ---------------------------------------------------------------------------
// 7. Credential redaction
// ---------------------------------------------------------------------------

describe('Credential redaction helpers', () => {
  it('redacts connector api_key but keeps base_url', () => {
    const row = {
      id: 'conn-1',
      connector_type: 'vault',
      config: { base_url: 'http://vault:8765', api_key: 'super-secret' },
    };
    const redacted = redactConnectorSecrets(row);
    expect(redacted.config?.['api_key']).toBe('***redacted***');
    expect(redacted.config?.['base_url']).toBe('http://vault:8765');
    // Original untouched (no in-place mutation of stored rows).
    expect(row.config['api_key']).toBe('super-secret');
  });

  it('redacts webhook secret from triggers, passes secretless configs through', () => {
    expect(
      redactTriggerSecrets({ id: 't1', config: { secret: 'hook-secret' } }).config?.['secret'],
    ).toBe('***redacted***');
    expect(
      redactTriggerSecrets({ id: 't2', config: { expression: '* * * * *' } }).config,
    ).toEqual({ expression: '* * * * *' });
  });
});
