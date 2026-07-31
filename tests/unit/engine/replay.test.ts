/**
 * Unit tests — V1.3 M1 event-sourced replay (F-Loop-1).
 *
 *  - R1 reconstructExecution: an event sequence folds into the correct snapshot
 *    (status / per-node states / outputs / errors / timeline). The fold is pure.
 *  - R2 replayExecution: the DEFAULT dry-run produces correct per-node decisions
 *    and NEVER invokes connectors (no side effects); dryRun=false re-executes
 *    via the V1.1 resume path (succeeded nodes skipped).
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  createSqliteConnection,
  SqliteStateStore,
  type SqliteConnection,
} from '../../../packages/state/src';
import { ConnectorRegistry, type ConnectorAdapter } from '../../../packages/connectors/src';
import { ExecutionExecutor } from '../../../packages/engine/src/executor';
import {
  foldExecutionEvents,
  reconstructExecution,
  replayExecution,
  computeReplayDecisions,
} from '../../../packages/engine/src/replay';
import type { ExecutionEvent, WorkflowDefinition, ConnectorCapabilities } from '../../../packages/types/src';

/** Adapter that counts execute() invocations and always succeeds. */
function okAdapter(type: string): { adapter: ConnectorAdapter; counter: { calls: number } } {
  const counter = { calls: 0 };
  const adapter: ConnectorAdapter = {
    type,
    async execute() {
      counter.calls += 1;
      return { output: { ok: true, via: type } };
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

/** Adapter that counts execute() invocations and always throws. */
function failingAdapter(type: string): { adapter: ConnectorAdapter; counter: { calls: number } } {
  const counter = { calls: 0 };
  const adapter: ConnectorAdapter = {
    type,
    async execute() {
      counter.calls += 1;
      throw new Error(`${type} exploded`);
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
    name: 'Replay test',
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
    trigger_payload: {},
  });
  return executionId;
}

function node(id: string, type: string) {
  return { id, type, position: { x: 0, y: 0 }, config: {} };
}

function event(
  executionId: string,
  seq: number,
  event_type: ExecutionEvent['event_type'],
  node_id: string | undefined,
  payload: Record<string, unknown> = {},
): ExecutionEvent {
  return {
    id: `${executionId}-${seq}`,
    execution_id: executionId,
    event_type,
    ...(node_id !== undefined ? { node_id } : {}),
    payload,
    created_at: 1_700_000_000_000 + seq * 1000,
  };
}

const TWO_NODE: WorkflowDefinition = {
  version: '1.0',
  nodes: [node('a', 'ok.op'), node('b', 'bad.op')],
  edges: [{ id: 'e', source: 'a', target: 'b' }],
  variables: {},
  metadata: { name: 'two-node' },
};

describe('replay — foldExecutionEvents (R1, pure)', () => {
  it('folds an event sequence into the correct snapshot', () => {
    const execId = 'exec-fold';
    const events = [
      event(execId, 1, 'execution_started', undefined),
      event(execId, 2, 'node_started', 'a'),
      event(execId, 3, 'node_succeeded', 'a', { output: { ok: true } }),
      event(execId, 4, 'node_started', 'b'),
      event(execId, 5, 'node_failed', 'b', { error: 'boom' }),
      event(execId, 6, 'execution_failed', undefined, { error: 'boom', reason: 'node_error' }),
    ];

    const snap = foldExecutionEvents(execId, events);

    expect(snap.executionId).toBe(execId);
    expect(snap.status).toBe('failed');
    expect(snap.startedAt).toBe(new Date(1_700_000_001_000).toISOString());
    expect(snap.endedAt).toBe(new Date(1_700_000_006_000).toISOString());
    expect(snap.error).toBe('boom');

    expect(snap.nodeStates.get('a')).toMatchObject({ status: 'succeeded', output: { ok: true } });
    expect(snap.nodeStates.get('b')).toMatchObject({ status: 'failed', error: 'boom' });

    expect(snap.timeline).toHaveLength(6);
    expect(snap.timeline[0]).toMatchObject({ type: 'execution_started' });
    expect(snap.timeline[5]).toMatchObject({ type: 'execution_failed', detail: 'boom' });
  });

  it('folds a fully-succeeded execution and a skipped node', () => {
    const execId = 'exec-ok';
    const events = [
      event(execId, 1, 'execution_started', undefined, { resumed: true }),
      event(execId, 2, 'node_skipped', 'a', { reason: 'already_succeeded' }),
      event(execId, 3, 'node_started', 'b'),
      event(execId, 4, 'node_succeeded', 'b'),
      event(execId, 5, 'execution_succeeded', undefined),
    ];

    const snap = foldExecutionEvents(execId, events);
    expect(snap.status).toBe('succeeded');
    expect(snap.nodeStates.get('a')).toMatchObject({ status: 'skipped' });
    expect(snap.nodeStates.get('b')).toMatchObject({ status: 'succeeded' });
  });

  it('is deterministic — same events yield an equal snapshot', () => {
    const execId = 'exec-det';
    const events = [
      event(execId, 1, 'execution_started', undefined),
      event(execId, 2, 'node_succeeded', 'a', { output: { v: 1 } }),
      event(execId, 3, 'execution_succeeded', undefined),
    ];
    const first = foldExecutionEvents(execId, events);
    const second = foldExecutionEvents(execId, events);
    expect(second).toEqual(first);
  });
});

describe('replay — reconstructExecution (R1, store-backed)', () => {
  const conns: SqliteConnection[] = [];
  afterEach(() => {
    while (conns.length > 0) conns.pop()!.close();
  });

  it('reconstructs from persisted execution_events after a real run', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(okAdapter('ok').adapter);
    connectors.registerAdapter(failingAdapter('bad').adapter);

    const executionId = await seedExecution(store, TWO_NODE);
    const executor = new ExecutionExecutor(store, connectors, 10, 5_000);
    await expect(executor.execute(executionId, TWO_NODE, {})).rejects.toThrow(/bad exploded/);

    const snap = await reconstructExecution(store, executionId);
    expect(snap.status).toBe('failed');
    expect(snap.nodeStates.get('a')?.status).toBe('succeeded');
    expect(snap.nodeStates.get('b')?.status).toBe('failed');
    expect(snap.timeline.some((t) => t.type === 'execution_failed')).toBe(true);
  });
});

describe('replay — replayExecution dry-run (R2)', () => {
  const conns: SqliteConnection[] = [];
  afterEach(() => {
    while (conns.length > 0) conns.pop()!.close();
  });

  it('dry-run does NOT invoke connectors and yields correct decisions (failed run)', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const ok = okAdapter('ok');
    const bad = failingAdapter('bad');
    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(ok.adapter);
    connectors.registerAdapter(bad.adapter);

    const executionId = await seedExecution(store, TWO_NODE);
    const executor = new ExecutionExecutor(store, connectors, 10, 5_000);
    await expect(executor.execute(executionId, TWO_NODE, {})).rejects.toThrow(/bad exploded/);

    const callsBefore = { ok: ok.counter.calls, bad: bad.counter.calls };
    expect(callsBefore.ok).toBe(1);
    expect(callsBefore.bad).toBe(1);

    // DEFAULT dry-run (no options) — must be side-effect-free.
    const result = await replayExecution(executor, store, executionId);
    expect(result.dryRun).toBe(true);
    expect(result.snapshot.status).toBe('failed');

    // Connectors were NOT called again by the dry-run.
    expect(ok.counter.calls).toBe(callsBefore.ok);
    expect(bad.counter.calls).toBe(callsBefore.bad);

    const byNode = new Map(result.decisions.map((d) => [d.nodeId, d.decision]));
    expect(byNode.get('a')).toBe('skipped-because-succeeded');
    expect(byNode.get('b')).toBe('failed');
    expect(result.rerun).toBeUndefined();
  });

  it('dry-run marks every node skipped-because-succeeded for a completed run', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const ok = okAdapter('ok');
    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(ok.adapter);

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('a', 'ok.op'), node('b', 'ok.op')],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
      variables: {},
      metadata: { name: 'all-ok' },
    };
    const executionId = await seedExecution(store, definition);
    const executor = new ExecutionExecutor(store, connectors, 10, 5_000);
    await executor.execute(executionId, definition, {});
    expect(ok.counter.calls).toBe(2);

    const result = await replayExecution(executor, store, executionId, { dryRun: true });
    expect(ok.counter.calls).toBe(2); // unchanged — no side effects
    expect(result.decisions.every((d) => d.decision === 'skipped-because-succeeded')).toBe(true);
  });

  it('dry-run marks never-reached nodes as would-run', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(okAdapter('ok').adapter);

    // Execution created but never run → no events at all.
    const executionId = await seedExecution(store, TWO_NODE);
    const executor = new ExecutionExecutor(store, connectors, 10, 5_000);

    const result = await replayExecution(executor, store, executionId, { dryRun: true });
    expect(result.snapshot.status).toBe('pending');
    expect(result.decisions.every((d) => d.decision === 'would-run')).toBe(true);
  });

  it('computeReplayDecisions orders decisions topologically', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);
    const executionId = await seedExecution(store, TWO_NODE);
    const snap = await reconstructExecution(store, executionId);
    const decisions = computeReplayDecisions(TWO_NODE, snap);
    expect(decisions.map((d) => d.nodeId)).toEqual(['a', 'b']);
  });

  it('dryRun=false re-executes via the resume path, skipping succeeded nodes', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const ok = okAdapter('ok');
    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(ok.adapter);

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('a', 'ok.op'), node('b', 'ok.op')],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
      variables: {},
      metadata: { name: 'rerun-ok' },
    };
    const executionId = await seedExecution(store, definition);
    const executor = new ExecutionExecutor(store, connectors, 10, 5_000);
    await executor.execute(executionId, definition, {});
    expect(ok.counter.calls).toBe(2);

    // Real re-run: both nodes already succeeded → resume skips both (no dispatch).
    const result = await replayExecution(executor, store, executionId, { dryRun: false });
    expect(result.dryRun).toBe(false);
    expect(result.rerun?.status).toBe('succeeded');
    expect(result.rerun?.outputs).toHaveProperty('a');
    expect(result.rerun?.outputs).toHaveProperty('b');
    expect(ok.counter.calls).toBe(2); // unchanged — succeeded nodes skipped
  });

  it('throws NOT_FOUND for an unknown execution', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);
    const connectors = new ConnectorRegistry();
    const executor = new ExecutionExecutor(store, connectors, 10, 5_000);
    await expect(replayExecution(executor, store, crypto.randomUUID())).rejects.toThrow(/not found/);
  });
});
