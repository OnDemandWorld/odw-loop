/**
 * Unit tests — PostgreSQL StateStore adapter (V1.5 M1, F-1 Scale layer).
 *
 * These tests use a MOCK pg client: a fake `pool.query` records every SQL
 * string + parameter list and returns programmable rows. This verifies the
 * adapter emits correct parameterized ($1...) SQL and maps rows to the
 * StateStore shapes WITHOUT requiring a real PostgreSQL server (PRD §7: PG
 * adaptation is validated via mock-client / SQL assertions; real-PG wiring is a
 * deployment acceptance concern).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostgresStateStore } from '../../../packages/state/src/postgres/index.js';
import type { PostgresConnection } from '../../../packages/state/src/postgres/connection.js';

interface QueryCall {
  sql: string;
  params: unknown[];
}

interface MockConn {
  conn: PostgresConnection;
  calls: QueryCall[];
  query: ReturnType<typeof vi.fn>;
  /** Program the rows returned by the next `query` calls (FIFO). */
  enqueueRows: (...rowSets: Record<string, unknown>[][]) => void;
}

function createMockConn(): MockConn {
  const calls: QueryCall[] = [];
  const queue: Record<string, unknown>[][] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    const normalized = params ?? [];
    calls.push({ sql, params: normalized });
    const rows = queue.shift() ?? [];
    return { rows };
  });
  const conn = {
    pool: { query },
    close: vi.fn(),
  } as unknown as PostgresConnection;
  return {
    conn,
    calls,
    query,
    enqueueRows: (...rowSets) => {
      for (const set of rowSets) queue.push(set);
    },
  };
}

/** Last recorded query (handy for single-statement methods). */
function lastCall(calls: QueryCall[]): QueryCall {
  const call = calls[calls.length - 1];
  if (!call) throw new Error('No query recorded');
  return call;
}

describe('PostgresStateStore — executions (PG2)', () => {
  let mock: MockConn;
  let store: PostgresStateStore;

  beforeEach(() => {
    mock = createMockConn();
    store = new PostgresStateStore(mock.conn);
  });

  it('create inserts a pending execution with parameterized SQL then reads it back', async () => {
    mock.enqueueRows(
      [], // INSERT
      [{
        id: 'exec-1', workflow_id: 'wf-1', workflow_version: 3, trigger_type: 'manual',
        trigger_payload: { source: 'test' }, status: 'pending', started_at: null,
        completed_at: null, duration_ms: null, error: null, initiated_by: 'system',
      }], // SELECT
    );

    const result = await store.executions.create({
      id: 'exec-1', workflow_id: 'wf-1', workflow_version: 3,
      trigger_type: 'manual', trigger_payload: { source: 'test' }, initiated_by: 'system',
    });

    const insert = mock.calls[0]!;
    expect(insert.sql).toContain('INSERT INTO workflow_executions');
    expect(insert.sql).toContain("'pending'");
    expect(insert.sql).toMatch(/\$1/);
    expect(insert.params).toEqual(['exec-1', 'wf-1', 3, 'manual', '{"source":"test"}', 'system']);

    expect(result).toMatchObject({
      id: 'exec-1', workflow_id: 'wf-1', workflow_version: 3,
      trigger_type: 'manual', status: 'pending', initiated_by: 'system',
    });
    expect(result.trigger_payload).toEqual({ source: 'test' });
  });

  it('getById returns null when no row matches', async () => {
    mock.enqueueRows([]);
    const result = await store.executions.getById('missing');
    expect(lastCall(mock.calls).sql).toBe('SELECT * FROM workflow_executions WHERE id = $1');
    expect(lastCall(mock.calls).params).toEqual(['missing']);
    expect(result).toBeNull();
  });

  it('list builds dynamic WHERE clauses and paginates', async () => {
    mock.enqueueRows(
      [{ count: 2 }], // count
      [{
        id: 'exec-1', workflow_id: 'wf-1', workflow_version: 1, trigger_type: 'cron',
        trigger_payload: {}, status: 'running', started_at: '2026-08-01T00:00:00.000Z',
        completed_at: null, duration_ms: null, error: null, initiated_by: null,
      }], // data
    );

    const result = await store.executions.list(
      { workflow_id: 'wf-1', status: 'running', trigger_type: 'cron' },
      { page: 2, per_page: 10 },
    );

    const countCall = mock.calls[0]!;
    expect(countCall.sql).toContain('SELECT count(*)::int AS count FROM workflow_executions');
    expect(countCall.sql).toContain('workflow_id = $1');
    expect(countCall.sql).toContain('status = $2');
    expect(countCall.sql).toContain('trigger_type = $3');
    expect(countCall.params).toEqual(['wf-1', 'running', 'cron']);

    const dataCall = mock.calls[1]!;
    expect(dataCall.sql).toContain('ORDER BY started_at DESC NULLS LAST');
    expect(dataCall.sql).toContain('LIMIT $4 OFFSET $5');
    expect(dataCall.params).toEqual(['wf-1', 'running', 'cron', 10, 10]); // offset = (2-1)*10

    expect(result.total).toBe(2);
    expect(result.page).toBe(2);
    expect(result.total_pages).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.status).toBe('running');
  });

  it('updateStatus writes all status fields with null fallbacks', async () => {
    mock.enqueueRows([]);
    await store.executions.updateStatus('exec-1', { status: 'failed', error: 'boom' });
    const call = lastCall(mock.calls);
    expect(call.sql).toBe('UPDATE workflow_executions SET status = $2, started_at = $3, completed_at = $4, duration_ms = $5, error = $6 WHERE id = $1');
    expect(call.params).toEqual(['exec-1', 'failed', null, null, null, 'boom']);
  });

  it('findInterrupted selects running and pending executions (bug 12)', async () => {
    mock.enqueueRows([]);
    await store.executions.findInterrupted();
    expect(lastCall(mock.calls).sql).toBe("SELECT * FROM workflow_executions WHERE status IN ('running', 'pending')");
  });
});

describe('PostgresStateStore — nodeExecutions (PG2)', () => {
  let mock: MockConn;
  let store: PostgresStateStore;

  beforeEach(() => {
    mock = createMockConn();
    store = new PostgresStateStore(mock.conn);
  });

  it('create inserts a pending node execution with an idempotency key', async () => {
    mock.enqueueRows(
      [], // INSERT
      [{
        id: 'ne-1', execution_id: 'exec-1', node_id: 'node_a', node_type: 'vault.search',
        status: 'pending', input: { q: 'x' }, output: {}, error: null, started_at: null,
        completed_at: null, retry_count: 0, metadata: {}, idempotency_key: 'exec-1:node_a',
      }], // SELECT
    );

    const result = await store.nodeExecutions.create({
      id: 'ne-1', execution_id: 'exec-1', node_id: 'node_a',
      node_type: 'vault.search', input: { q: 'x' }, idempotency_key: 'exec-1:node_a',
    });

    const insert = mock.calls[0]!;
    expect(insert.sql).toContain('INSERT INTO node_executions');
    expect(insert.sql).toContain("'pending'");
    expect(insert.params).toEqual(['ne-1', 'exec-1', 'node_a', 'vault.search', '{"q":"x"}', 'exec-1:node_a']);
    expect(result.idempotency_key).toBe('exec-1:node_a');
    expect(result.input).toEqual({ q: 'x' });
  });

  it('findByIdempotencyKey returns null when absent', async () => {
    mock.enqueueRows([]);
    const result = await store.nodeExecutions.findByIdempotencyKey('exec-1:node_z');
    expect(lastCall(mock.calls).sql).toBe('SELECT * FROM node_executions WHERE idempotency_key = $1');
    expect(lastCall(mock.calls).params).toEqual(['exec-1:node_z']);
    expect(result).toBeNull();
  });

  it('listByExecution orders by started_at ascending', async () => {
    mock.enqueueRows([]);
    await store.nodeExecutions.listByExecution('exec-1');
    const call = lastCall(mock.calls);
    expect(call.sql).toBe('SELECT * FROM node_executions WHERE execution_id = $1 ORDER BY started_at ASC NULLS FIRST');
    expect(call.params).toEqual(['exec-1']);
  });

  it('updateStatus only overwrites output/retry_count/metadata when supplied', async () => {
    // Without optional fields → only the four always-written columns.
    mock.enqueueRows([]);
    await store.nodeExecutions.updateStatus('ne-1', { status: 'running', started_at: '2026-08-01T00:00:00.000Z' });
    const minimal = lastCall(mock.calls);
    expect(minimal.sql).toBe('UPDATE node_executions SET status = $2, started_at = $3, completed_at = $4, error = $5 WHERE id = $1');
    expect(minimal.params).toEqual(['ne-1', 'running', '2026-08-01T00:00:00.000Z', null, null]);

    // With optional fields → dynamic SET clauses appended.
    mock.enqueueRows([]);
    await store.nodeExecutions.updateStatus('ne-1', {
      status: 'succeeded', completed_at: '2026-08-01T00:00:01.000Z',
      output: { ok: true }, retry_count: 2, metadata: { attempt: 2 },
    });
    const full = lastCall(mock.calls);
    expect(full.sql).toContain('output = $6');
    expect(full.sql).toContain('retry_count = $7');
    expect(full.sql).toContain('metadata = $8');
    expect(full.params).toEqual([
      'ne-1', 'succeeded', null, '2026-08-01T00:00:01.000Z', null,
      '{"ok":true}', 2, '{"attempt":2}',
    ]);
  });
});

describe('PostgresStateStore — events (PG2)', () => {
  let mock: MockConn;
  let store: PostgresStateStore;

  beforeEach(() => {
    mock = createMockConn();
    store = new PostgresStateStore(mock.conn);
  });

  it('append inserts a parameterized execution event', async () => {
    mock.enqueueRows([]);
    await store.events.append({
      id: 'evt-1', execution_id: 'exec-1', event_type: 'node_succeeded',
      node_id: 'node_a', payload: { duration_ms: 12 }, created_at: 1_700_000_000_000,
    });
    const call = lastCall(mock.calls);
    expect(call.sql).toContain('INSERT INTO execution_events');
    expect(call.params).toEqual(['evt-1', 'exec-1', 'node_succeeded', 'node_a', '{"duration_ms":12}', 1_700_000_000_000]);
  });

  it('listByExecution orders events by created_at ascending and parses payloads', async () => {
    mock.enqueueRows([{
      id: 'evt-1', execution_id: 'exec-1', event_type: 'execution_started',
      node_id: null, payload: { resumed: false }, created_at: 1_700_000_000_000,
    }]);
    const events = await store.events.listByExecution('exec-1');
    expect(lastCall(mock.calls).sql).toBe('SELECT * FROM execution_events WHERE execution_id = $1 ORDER BY created_at ASC');
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ resumed: false });
    expect(events[0]!.created_at).toBe(1_700_000_000_000);
  });
});

describe('PostgresStateStore — workflowDefinitions (PG3)', () => {
  let mock: MockConn;
  let store: PostgresStateStore;

  beforeEach(() => {
    mock = createMockConn();
    store = new PostgresStateStore(mock.conn);
  });

  const definition = { version: '1.0', nodes: [], edges: [], variables: {}, metadata: { name: 'wf' } };

  it('create inserts a versioned snapshot and maps the definition', async () => {
    mock.enqueueRows(
      [], // INSERT
      [{
        id: 'wfd-1', workflow_id: 'wf-1', version: 2, definition,
        commit_hash: 'abc123', created_by: 'system', created_at: '2026-08-01T00:00:00.000Z',
        change_summary: 'edit',
      }], // SELECT
    );
    const result = await store.workflowDefinitions.create({
      id: 'wfd-1', workflow_id: 'wf-1', version: 2, definition,
      commit_hash: 'abc123', created_by: 'system', change_summary: 'edit',
    });
    const insert = mock.calls[0]!;
    expect(insert.sql).toContain('INSERT INTO workflow_definitions');
    expect(insert.params[0]).toBe('wfd-1');
    expect(insert.params[2]).toBe(2);
    expect(result.definition).toEqual(definition);
    expect(result.change_summary).toBe('edit');
  });

  it('listByWorkflow orders by version descending', async () => {
    mock.enqueueRows([]);
    await store.workflowDefinitions.listByWorkflow('wf-1');
    const call = lastCall(mock.calls);
    expect(call.sql).toBe('SELECT * FROM workflow_definitions WHERE workflow_id = $1 ORDER BY version DESC');
    expect(call.params).toEqual(['wf-1']);
  });

  it('getByWorkflowAndVersion returns null when absent', async () => {
    mock.enqueueRows([]);
    const result = await store.workflowDefinitions.getByWorkflowAndVersion('wf-1', 9);
    expect(lastCall(mock.calls).sql).toBe('SELECT * FROM workflow_definitions WHERE workflow_id = $1 AND version = $2');
    expect(lastCall(mock.calls).params).toEqual(['wf-1', 9]);
    expect(result).toBeNull();
  });
});

describe('PostgresStateStore — connectors (PG3)', () => {
  let mock: MockConn;
  let store: PostgresStateStore;

  beforeEach(() => {
    mock = createMockConn();
    store = new PostgresStateStore(mock.conn);
  });

  it('create inserts a disconnected connector and maps config', async () => {
    mock.enqueueRows(
      [], // INSERT
      [{
        id: 'conn-1', connector_type: 'vault', name: 'Vault Prod',
        config: { base_url: 'http://vault:8765' }, status: 'disconnected',
        last_health_check: null, created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
      }], // SELECT
    );
    const result = await store.connectors.create({
      id: 'conn-1', connector_type: 'vault', name: 'Vault Prod', config: { base_url: 'http://vault:8765' },
    });
    const insert = mock.calls[0]!;
    expect(insert.sql).toContain('INSERT INTO connectors');
    expect(insert.sql).toContain("'disconnected'");
    expect(insert.params.slice(0, 4)).toEqual(['conn-1', 'vault', 'Vault Prod', '{"base_url":"http://vault:8765"}']);
    expect(typeof insert.params[4]).toBe('string'); // created_at/updated_at = now (ISO)
    expect(result.config).toEqual({ base_url: 'http://vault:8765' });
    expect(result.status).toBe('disconnected');
  });

  it('getById returns null when no row matches', async () => {
    mock.enqueueRows([]);
    const result = await store.connectors.getById('missing');
    expect(lastCall(mock.calls).params).toEqual(['missing']);
    expect(result).toBeNull();
  });

  it('update builds dynamic SET clauses and always bumps updated_at', async () => {
    mock.enqueueRows([]);
    await store.connectors.update('conn-1', { status: 'connected', last_health_check: '2026-08-01T01:00:00.000Z' });
    const call = lastCall(mock.calls);
    expect(call.sql).toContain('UPDATE connectors SET updated_at = $2');
    expect(call.sql).toContain('status = $3');
    expect(call.sql).toContain('last_health_check = $4');
    expect(call.params[0]).toBe('conn-1');
    expect(call.params[2]).toBe('connected');
    expect(call.params[3]).toBe('2026-08-01T01:00:00.000Z');
  });

  it('delete removes by id', async () => {
    mock.enqueueRows([]);
    await store.connectors.delete('conn-1');
    expect(lastCall(mock.calls).sql).toBe('DELETE FROM connectors WHERE id = $1');
    expect(lastCall(mock.calls).params).toEqual(['conn-1']);
  });
});

describe('PostgresStateStore — remaining entities reach parity (PG3)', () => {
  let mock: MockConn;
  let store: PostgresStateStore;

  beforeEach(() => {
    mock = createMockConn();
    store = new PostgresStateStore(mock.conn);
  });

  it('triggers.create inserts an enabled trigger', async () => {
    mock.enqueueRows([], [{
      id: 'trg-1', workflow_id: 'wf-1', trigger_type: 'cron', config: { expr: '* * * * *' },
      enabled: true, created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
    }]);
    const result = await store.triggers.create({ id: 'trg-1', workflow_id: 'wf-1', trigger_type: 'cron', config: { expr: '* * * * *' } });
    expect(mock.calls[0]!.sql).toContain('INSERT INTO workflow_triggers');
    expect(result.enabled).toBe(true);
    expect(result.config).toEqual({ expr: '* * * * *' });
  });

  it('users.create inserts an active user and maps the public shape', async () => {
    mock.enqueueRows([], [{
      id: 'u-1', username: 'alice', email: 'alice@x.io', role: 'admin',
      password_hash: 'h', display_name: 'Alice', created_at: '2026-08-01T00:00:00.000Z',
      is_active: true, last_login_at: null,
    }]);
    const result = await store.users.create({ id: 'u-1', username: 'alice', password_hash: 'h', email: 'alice@x.io', role: 'admin', display_name: 'Alice' });
    expect(mock.calls[0]!.sql).toContain('INSERT INTO users');
    expect(result).toEqual({ id: 'u-1', username: 'alice', email: 'alice@x.io', role: 'admin', display_name: 'Alice', created_at: '2026-08-01T00:00:00.000Z', is_active: true });
  });

  it('secrets.getByName scopes the lookup when scope/scopeId supplied', async () => {
    mock.enqueueRows([]);
    await store.secrets.getByName('TOKEN', 'connector', 'conn-1');
    const call = lastCall(mock.calls);
    expect(call.sql).toBe('SELECT * FROM secrets WHERE name = $1 AND scope = $2 AND scope_id = $3');
    expect(call.params).toEqual(['TOKEN', 'connector', 'conn-1']);
  });

  it('egressPolicies.listEnabled orders by priority descending', async () => {
    mock.enqueueRows([]);
    await store.egressPolicies.listEnabled();
    expect(lastCall(mock.calls).sql).toBe('SELECT * FROM egress_policies WHERE enabled = true ORDER BY priority DESC');
  });

  it('audit.write inserts an audit event and retries on failure', async () => {
    // First two attempts fail (recording the call), third falls through to the
    // default mock implementation (returns the enqueued rows) → no throw.
    mock.query
      .mockImplementationOnce(async (sql: string, params?: unknown[]) => {
        mock.calls.push({ sql, params: params ?? [] });
        throw new Error('transient');
      })
      .mockImplementationOnce(async (sql: string, params?: unknown[]) => {
        mock.calls.push({ sql, params: params ?? [] });
        throw new Error('transient');
      });
    mock.enqueueRows([]); // third attempt succeeds via the default implementation
    await expect(store.audit.write({ id: 'a-1', actor: 'system', action: 'create', resource_type: 'workflow' })).resolves.not.toThrow();
    expect(mock.query).toHaveBeenCalledTimes(3);
    expect(mock.calls[0]!.sql).toContain('INSERT INTO audit_events');
  });
});
