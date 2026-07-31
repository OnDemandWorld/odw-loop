/**
 * Unit tests — V1.1 M1 state layer: execution_events (append-only) + node
 * idempotency key (F1 durable recovery / F2 idempotency).
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  createSqliteConnection,
  SqliteStateStore,
  type SqliteConnection,
} from '../../../packages/state/src';
import { runMigrations } from '../../../packages/state/src/migrate.js';
import type { WorkflowDefinition } from '../../../packages/types/src';

const DEFINITION: WorkflowDefinition = {
  version: '1.0',
  nodes: [],
  edges: [],
  variables: {},
  metadata: { name: 'events-test' },
};

async function createStore(): Promise<{ conn: SqliteConnection; store: SqliteStateStore }> {
  const conn = createSqliteConnection({ path: ':memory:', wal: false });
  const store = new SqliteStateStore(conn);
  await store.initialise();
  await store.users.create({
    id: 'system',
    username: 'system',
    password_hash: '',
    email: 'system@loop.internal',
    role: 'admin',
  });
  return { conn, store };
}

async function seedExecution(store: SqliteStateStore): Promise<string> {
  const workflowId = crypto.randomUUID();
  await store.workflows.create({
    id: workflowId,
    name: 'Events test',
    description: '',
    definition: DEFINITION,
    created_by: 'system',
  });
  const executionId = crypto.randomUUID();
  await store.executions.create({
    id: executionId,
    workflow_id: workflowId,
    workflow_version: 1,
    trigger_type: 'manual',
  });
  return executionId;
}

describe('StateStore — execution events (V1.1 M1)', () => {
  const conns: SqliteConnection[] = [];

  afterEach(() => {
    while (conns.length > 0) {
      conns.pop()!.close();
    }
  });

  it('appends and lists events in creation order', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);
    const executionId = await seedExecution(store);

    await store.events.append({
      id: crypto.randomUUID(),
      execution_id: executionId,
      event_type: 'execution_started',
      created_at: 1000,
    });
    await store.events.append({
      id: crypto.randomUUID(),
      execution_id: executionId,
      event_type: 'node_succeeded',
      node_id: 'node_a',
      payload: { duration_ms: 12 },
      created_at: 2000,
    });
    await store.events.append({
      id: crypto.randomUUID(),
      execution_id: executionId,
      event_type: 'execution_succeeded',
      created_at: 3000,
    });

    const events = await store.events.listByExecution(executionId);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.event_type)).toEqual([
      'execution_started',
      'node_succeeded',
      'execution_succeeded',
    ]);
    expect(events[1]!.node_id).toBe('node_a');
    expect(events[1]!.payload).toMatchObject({ duration_ms: 12 });
  });

  it('isolates events per execution', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);
    const execA = await seedExecution(store);
    const execB = await seedExecution(store);

    await store.events.append({ id: crypto.randomUUID(), execution_id: execA, event_type: 'execution_started' });
    await store.events.append({ id: crypto.randomUUID(), execution_id: execB, event_type: 'execution_started' });
    await store.events.append({ id: crypto.randomUUID(), execution_id: execB, event_type: 'execution_failed' });

    expect(await store.events.listByExecution(execA)).toHaveLength(1);
    expect(await store.events.listByExecution(execB)).toHaveLength(2);
  });
});

describe('StateStore — node idempotency key (V1.1 M1)', () => {
  const conns: SqliteConnection[] = [];

  afterEach(() => {
    while (conns.length > 0) {
      conns.pop()!.close();
    }
  });

  it('persists and looks up a node execution by idempotency key', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);
    const executionId = await seedExecution(store);
    const key = `${executionId}:node_a`;

    const created = await store.nodeExecutions.create({
      id: crypto.randomUUID(),
      execution_id: executionId,
      node_id: 'node_a',
      node_type: 'vault.search',
      input: { q: 1 },
      idempotency_key: key,
    });
    expect(created.idempotency_key).toBe(key);

    const found = await store.nodeExecutions.findByIdempotencyKey(key);
    expect(found).not.toBeNull();
    expect(found!.node_id).toBe('node_a');

    const missing = await store.nodeExecutions.findByIdempotencyKey(`${executionId}:nope`);
    expect(missing).toBeNull();
  });

  it('allows multiple rows with NULL idempotency key (V1.0 backward compat)', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);
    const executionId = await seedExecution(store);

    // No idempotency_key supplied → NULL; the unique index treats NULLs as
    // distinct, so repeated keyless inserts must not collide.
    await store.nodeExecutions.create({
      id: crypto.randomUUID(),
      execution_id: executionId,
      node_id: 'node_a',
      node_type: 'vault.search',
    });
    await expect(
      store.nodeExecutions.create({
        id: crypto.randomUUID(),
        execution_id: executionId,
        node_id: 'node_b',
        node_type: 'vault.search',
      }),
    ).resolves.toBeDefined();
  });

  it('enforces uniqueness on a populated idempotency key', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);
    const executionId = await seedExecution(store);
    const key = `${executionId}:node_dup`;

    await store.nodeExecutions.create({
      id: crypto.randomUUID(),
      execution_id: executionId,
      node_id: 'node_dup',
      node_type: 'vault.search',
      idempotency_key: key,
    });

    await expect(
      store.nodeExecutions.create({
        id: crypto.randomUUID(),
        execution_id: executionId,
        node_id: 'node_dup',
        node_type: 'vault.search',
        idempotency_key: key,
      }),
    ).rejects.toThrow();
  });
});

describe('Migration 002 — idempotency (V1.1 M1)', () => {
  it('creates execution_events and is safe to re-run', async () => {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    try {
      await runMigrations(conn);
      // Re-running must be a no-op (version tracking), not an error.
      await expect(runMigrations(conn)).resolves.not.toThrow();

      const tables = conn.client
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='execution_events'`)
        .all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);

      // node_executions gained the idempotency_key column.
      const cols = conn.client.prepare(`PRAGMA table_info(node_executions)`).all() as Array<{ name: string }>;
      expect(cols.map((c) => c.name)).toContain('idempotency_key');
    } finally {
      conn.close();
    }
  });
});
