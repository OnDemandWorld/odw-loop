/**
 * Unit tests — ExecutionExecutor parallel level scheduling + node timeout (§6.2).
 *
 * Uses an in-memory SQLite store and timing/concurrency-tracking mock adapters
 * to verify that:
 *   - independent nodes in the same topological level run concurrently,
 *   - `maxConcurrent` bounds the in-flight node count,
 *   - a node that exceeds its timeout fails the execution (NODE_TIMEOUT).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import { createEngineTestStore, seedEngineExecution } from '../../helpers/testStore.js';
import type { SqliteStateStore} from '../../../packages/state/src';
import { type SqliteConnection } from '../../../packages/state/src';
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
  return createEngineTestStore();
}

async function seedExecution(store: SqliteStateStore, definition: WorkflowDefinition): Promise<string> {
  return seedEngineExecution(store, definition);
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

describe('ExecutionExecutor — execution concurrency cap (audit #43)', () => {
  const conns: SqliteConnection[] = [];
  afterEach(async () => {
    while (conns.length > 0) conns.pop()!.close();
  });

  it('LOOP_MAX_CONCURRENT caps concurrent executions, not just nodes per level', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);
    const { adapter, stats } = createTrackingAdapter('slow', 60);
    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(adapter);

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('a', 'slow.op')],
      edges: [],
      variables: {},
      metadata: { name: 'cap' },
    };
    const e1 = await seedExecution(store, definition);
    const e2 = await seedExecution(store, definition);

    const executor = new ExecutionExecutor(store, connectors, 1, 5_000); // max 1 execution
    await Promise.all([executor.execute(e1, definition, {}), executor.execute(e2, definition, {})]);

    expect(stats.calls).toBe(2);
    expect(stats.maxInFlight).toBe(1); // serialized, never 2
    expect((await store.executions.getById(e1))?.status).toBe('succeeded');
    expect((await store.executions.getById(e2))?.status).toBe('succeeded');
  });
});

describe('ExecutionExecutor — startup failure counter hygiene (audit #118)', () => {
  const conns: SqliteConnection[] = [];
  afterEach(async () => {
    while (conns.length > 0) conns.pop()!.close();
  });

  it('a startup throw before the main try does not leak activeRuns', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);
    const { adapter } = createTrackingAdapter('ok', 1);
    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(adapter);
    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('a', 'ok.op')],
      edges: [],
      variables: {},
      metadata: { name: 'leak' },
    };
    const executionId = await seedExecution(store, definition);
    const executor = new ExecutionExecutor(store, connectors, 5, 5_000);

    const spy = vi.spyOn(store.executions, 'updateStatus').mockRejectedValueOnce(new Error('database is locked'));
    await expect(executor.execute(executionId, definition, {})).rejects.toThrow('database is locked');
    spy.mockRestore();

    // Drain must report fully drained immediately — no leaked active run.
    expect(await executor.drain(200)).toBe(true);
    // And the executor still works afterwards.
    await executor.execute(executionId, definition, {});
    expect((await store.executions.getById(executionId))?.status).toBe('succeeded');
  });
});
