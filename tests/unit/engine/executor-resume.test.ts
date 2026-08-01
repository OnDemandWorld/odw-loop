/**
 * Unit tests — V1.1 M1 executor reliability:
 *   - F1 resume: a re-run skips already-succeeded nodes (no duplicate dispatch),
 *   - F2 idempotency: re-executing the same execution reuses succeeded outputs,
 *   - F3 workflow-level timeout: a hung run fails with reason workflow_timeout.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  createSqliteConnection,
  SqliteStateStore,
  type SqliteConnection,
} from '../../../packages/state/src';
import { ConnectorRegistry, type ConnectorAdapter } from '../../../packages/connectors/src';
import { ExecutionExecutor } from '../../../packages/engine/src/executor';
import type { WorkflowDefinition, ConnectorCapabilities } from '../../../packages/types/src';

/** Adapter that counts execute() invocations. */
function createCountingAdapter(type: string, hang = false): { adapter: ConnectorAdapter; counter: { calls: number } } {
  const counter = { calls: 0 };
  const adapter: ConnectorAdapter = {
    type,
    async execute() {
      counter.calls += 1;
      if (hang) {
        return new Promise<never>(() => {
          /* never settles */
        });
      }
      return { output: { ok: true, n: counter.calls } };
    },
    async healthCheck() {
      return true;
    },
    getCapabilities(): ConnectorCapabilities {
      return { node_types: [`${type}.op`], input_types: ['any'], output_types: ['any'] };
    },
  };
  return { adapter, counter };
}

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

async function seedExecution(store: SqliteStateStore, definition: WorkflowDefinition): Promise<string> {
  const workflowId = crypto.randomUUID();
  await store.workflows.create({
    id: workflowId,
    name: 'Resume test',
    description: '',
    definition,
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

function node(id: string, type: string) {
  return { id, type, position: { x: 0, y: 0 }, config: {} };
}

const TWO_NODE: WorkflowDefinition = {
  version: '1.0',
  nodes: [node('a', 'track.op'), node('b', 'track.op')],
  edges: [{ id: 'e', source: 'a', target: 'b' }],
  variables: {},
  metadata: { name: 'two-node' },
};

describe('ExecutionExecutor — resume (V1.1 M1 F1)', () => {
  const conns: SqliteConnection[] = [];
  afterEach(() => {
    while (conns.length > 0) conns.pop()!.close();
  });

  it('skips already-succeeded nodes and dispatches only the rest', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const { adapter, counter } = createCountingAdapter('track');
    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(adapter);

    const executionId = await seedExecution(store, TWO_NODE);

    // Simulate a prior interrupted run: node 'a' already succeeded.
    const neId = crypto.randomUUID();
    await store.nodeExecutions.create({
      id: neId,
      execution_id: executionId,
      node_id: 'a',
      node_type: 'track.op',
      idempotency_key: `${executionId}:a`,
    });
    await store.nodeExecutions.updateStatus(neId, {
      status: 'succeeded',
      output: { ok: true, cached: true },
      completed_at: new Date().toISOString(),
    });

    const executor = new ExecutionExecutor(store, connectors, 10, 5_000);
    await executor.execute(executionId, TWO_NODE, {});

    // Only node 'b' was dispatched; 'a' was reused.
    expect(counter.calls).toBe(1);

    const execution = await store.executions.getById(executionId);
    expect(execution?.status).toBe('succeeded');

    // A node_skipped event was recorded for 'a'.
    const events = await store.events.listByExecution(executionId);
    const skipped = events.filter((e) => e.event_type === 'node_skipped');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.node_id).toBe('a');
  });

  it('re-executing a completed run re-dispatches nothing (idempotent)', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const { adapter, counter } = createCountingAdapter('track');
    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(adapter);

    const executionId = await seedExecution(store, TWO_NODE);
    const executor = new ExecutionExecutor(store, connectors, 10, 5_000);

    await executor.execute(executionId, TWO_NODE, {});
    expect(counter.calls).toBe(2);

    // Second run over the same execution: both nodes already succeeded → skipped.
    await executor.execute(executionId, TWO_NODE, {});
    expect(counter.calls).toBe(2); // unchanged

    const execution = await store.executions.getById(executionId);
    expect(execution?.status).toBe('succeeded');
  });

  it('writes a stable idempotency key per node execution', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const { adapter } = createCountingAdapter('track');
    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(adapter);

    const executionId = await seedExecution(store, TWO_NODE);
    const executor = new ExecutionExecutor(store, connectors, 10, 5_000);
    await executor.execute(executionId, TWO_NODE, {});

    const nodes = await store.nodeExecutions.listByExecution(executionId);
    const keys = nodes.map((n) => n.idempotency_key).sort();
    expect(keys).toEqual([`${executionId}:a`, `${executionId}:b`]);
  });
});

describe('ExecutionExecutor — workflow timeout (V1.1 M1 F3)', () => {
  const conns: SqliteConnection[] = [];
  afterEach(() => {
    while (conns.length > 0) conns.pop()!.close();
  });

  it('fails the execution with reason workflow_timeout when the deadline elapses', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const { adapter } = createCountingAdapter('hang', true);
    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(adapter);

    // Per-definition workflow timeout (200ms) overrides the large executor default.
    // V1.5 M1 (F-4', TH2): widened 50ms→200ms so the deadline timer is not starved
    // under high load; the node still hangs, so the workflow timeout always wins.
    const definition: WorkflowDefinition = {
      ...TWO_NODE,
      nodes: [node('stuck', 'hang.op')],
      edges: [],
      settings: { workflow_timeout_ms: 200 },
    };
    const executionId = await seedExecution(store, definition);

    // Node timeout is large so the NODE-level timer never fires first.
    const executor = new ExecutionExecutor(store, connectors, 10, 60_000);
    await expect(executor.execute(executionId, definition, {})).rejects.toThrow(/workflow_timeout/);

    const execution = await store.executions.getById(executionId);
    expect(execution?.status).toBe('failed');
    expect(execution?.error).toMatch(/workflow_timeout/);

    const events = await store.events.listByExecution(executionId);
    const failed = events.find((e) => e.event_type === 'execution_failed');
    expect(failed).toBeDefined();
    expect(failed!.payload).toMatchObject({ reason: 'workflow_timeout' });
  });

  it('does not time out a fast workflow when the deadline is generous', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const { adapter } = createCountingAdapter('track');
    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(adapter);

    const definition: WorkflowDefinition = { ...TWO_NODE, settings: { workflow_timeout_ms: 60_000 } };
    const executionId = await seedExecution(store, definition);
    const executor = new ExecutionExecutor(store, connectors, 10, 5_000);

    await executor.execute(executionId, definition, {});
    const execution = await store.executions.getById(executionId);
    expect(execution?.status).toBe('succeeded');
  });
});
