/**
 * Unit tests — ExecutionExecutor parallel level scheduling + node timeout (§6.2).
 *
 * Uses an in-memory SQLite store and timing/concurrency-tracking mock adapters
 * to verify that:
 *   - independent nodes in the same topological level run concurrently,
 *   - `maxConcurrent` bounds the in-flight node count,
 *   - a node that exceeds its timeout fails the execution (NODE_TIMEOUT).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSqliteConnection, SqliteStateStore, type SqliteConnection } from '../../../packages/state/src';
import { ConnectorRegistry, type ConnectorAdapter } from '../../../packages/connectors/src';
import { ExecutionExecutor } from '../../../packages/engine/src/executor';
import type { WorkflowDefinition, ConnectorCapabilities } from '../../../packages/types/src';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mock adapter that tracks concurrency and adds a configurable per-call delay. */
function createTrackingAdapter(type: string, delayMs: number): {
  adapter: ConnectorAdapter;
  stats: { inFlight: number; maxInFlight: number; calls: number };
} {
  const stats = { inFlight: 0, maxInFlight: 0, calls: 0 };
  const adapter: ConnectorAdapter = {
    type,
    async execute() {
      stats.calls += 1;
      stats.inFlight += 1;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      try {
        await sleep(delayMs);
        return { output: { ok: true } };
      } finally {
        stats.inFlight -= 1;
      }
    },
    async healthCheck() {
      return true;
    },
    getCapabilities(): ConnectorCapabilities {
      return { node_types: [`${type}.op`], input_types: ['any'], output_types: ['any'] };
    },
  };
  return { adapter, stats };
}

/** Mock adapter whose execute() never resolves — used to trigger the timeout. */
function createHangingAdapter(type: string): ConnectorAdapter {
  return {
    type,
    async execute() {
      return new Promise<never>(() => {
        /* never settles */
      });
    },
    async healthCheck() {
      return true;
    },
    getCapabilities(): ConnectorCapabilities {
      return { node_types: [`${type}.op`], input_types: ['any'], output_types: ['any'] };
    },
  };
}

interface Ctx {
  conn: SqliteConnection;
  store: SqliteStateStore;
}

async function createStore(): Promise<Ctx> {
  const conn = createSqliteConnection({ path: ':memory:', wal: false });
  const store = new SqliteStateStore(conn);
  await store.initialise();
  await store.users.create({
    id: 'system',
    username: 'system',
    password_hash: '',
    email: 'system@loop.internal',
    role: 'admin',
    display_name: 'System',
  });
  return { conn, store };
}

async function seedExecution(store: SqliteStateStore, definition: WorkflowDefinition): Promise<string> {
  const workflowId = `wf-${crypto.randomUUID()}`;
  await store.workflows.create({
    id: workflowId,
    name: 'Executor unit test',
    description: '',
    definition,
    created_by: 'system',
  });
  const executionId = `exec-${crypto.randomUUID()}`;
  await store.executions.create({
    id: executionId,
    workflow_id: workflowId,
    workflow_version: 1,
    trigger_type: 'manual',
    trigger_payload: {},
  });
  return executionId;
}

function node(id: string, type: string) {
  return { id, type, position: { x: 0, y: 0 }, config: {} };
}

describe('ExecutionExecutor — parallel levels & timeout', () => {
  const conns: SqliteConnection[] = [];

  afterEach(async () => {
    while (conns.length > 0) {
      conns.pop()!.close();
    }
  });

  it('runs independent nodes in the same level concurrently', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const { adapter, stats } = createTrackingAdapter('slow', 80);
    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(adapter);

    // Two independent roots → both land in level 0 and run in parallel.
    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('a', 'slow.op'), node('b', 'slow.op')],
      edges: [],
      variables: {},
      metadata: { name: 'parallel' },
    };
    const executionId = await seedExecution(store, definition);

    const executor = new ExecutionExecutor(store, connectors, 10, 5_000);
    const started = Date.now();
    await executor.execute(executionId, definition, {});
    const elapsed = Date.now() - started;

    expect(stats.calls).toBe(2);
    // Both nodes were in flight at once → genuine parallelism. This event-driven
    // counter is the authoritative proof of concurrency (it never flakes under load).
    expect(stats.maxInFlight).toBe(2);
    // V1.5 M1 (F-4', TH2): wall-clock sanity bound only. The previous 160ms ceiling
    // (just under the ~160ms sequential cost) raced OS scheduling jitter under high
    // load; the generous 1500ms cap still asserts the run completes promptly (well
    // under the 5000ms node timeout) while parallelism is proven by maxInFlight above.
    expect(elapsed).toBeLessThan(1500);

    const execution = await store.executions.getById(executionId);
    expect(execution?.status).toBe('succeeded');
  });

  it('respects maxConcurrent by batching nodes within a level', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const { adapter, stats } = createTrackingAdapter('slow', 40);
    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(adapter);

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('a', 'slow.op'), node('b', 'slow.op'), node('c', 'slow.op')],
      edges: [],
      variables: {},
      metadata: { name: 'batched' },
    };
    const executionId = await seedExecution(store, definition);

    // maxConcurrent = 1 → nodes run one at a time despite sharing a level.
    const executor = new ExecutionExecutor(store, connectors, 1, 5_000);
    await executor.execute(executionId, definition, {});

    expect(stats.calls).toBe(3);
    expect(stats.maxInFlight).toBe(1);

    const execution = await store.executions.getById(executionId);
    expect(execution?.status).toBe('succeeded');
  });

  it('fails the execution with NODE_TIMEOUT when a node exceeds its timeout', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(createHangingAdapter('hang'));

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('stuck', 'hang.op')],
      edges: [],
      variables: {},
      metadata: { name: 'timeout' },
    };
    const executionId = await seedExecution(store, definition);

    // V1.5 M1 (F-4', TH2): node timeout widened 50ms→200ms so the timer is not
    // starved under high load; the adapter still never resolves, so the timeout
    // race is deterministic. The assertion is unchanged apart from the value.
    const executor = new ExecutionExecutor(store, connectors, 10, 200);

    await expect(executor.execute(executionId, definition, {})).rejects.toThrow(/timed out after 200ms/);

    const execution = await store.executions.getById(executionId);
    expect(execution?.status).toBe('failed');
    expect(execution?.error).toMatch(/timed out/);

    const nodeExecs = await store.nodeExecutions.listByExecution(executionId);
    expect(nodeExecs).toHaveLength(1);
    expect(nodeExecs[0]!.status).toBe('failed');
    expect(nodeExecs[0]!.error).toMatch(/timed out/);
  });

  it('honours a per-node timeout_ms override', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(createHangingAdapter('hang'));

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [{ id: 'stuck', type: 'hang.op', position: { x: 0, y: 0 }, config: {}, timeout_ms: 200 }],
      edges: [],
      variables: {},
      metadata: { name: 'per-node-timeout' },
    };
    const executionId = await seedExecution(store, definition);

    // Executor-wide timeout is large, but the node override (200ms) wins.
    // V1.5 M1 (F-4', TH2): override widened 30ms→200ms for high-load stability;
    // it still differs from the 60_000ms executor default, so the override is proven.
    const executor = new ExecutionExecutor(store, connectors, 10, 60_000);
    await expect(executor.execute(executionId, definition, {})).rejects.toThrow(/timed out after 200ms/);
  });
});
