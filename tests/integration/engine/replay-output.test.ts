/**
 * Integration tests — replay output persistence (V1.4 M2, F-2).
 *
 * Runs the real engine against an in-memory SQLite store and asserts that:
 *  - a `node_succeeded` event persists the node output (size-capped) and
 *    `reconstructExecution` folds it back into `NodeSnapshot.output`;
 *  - an oversized output is persisted as a `{__truncated__, size, preview}`
 *    marker instead of the full payload (events table is not bloated);
 *  - old events without an `output` field still fold to `output === undefined`
 *    (backward compatible).
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  createSqliteConnection,
  SqliteStateStore,
  type SqliteConnection,
} from '../../../packages/state/src/index.js';
import { ConnectorRegistry, type ConnectorAdapter } from '../../../packages/connectors/src/index.js';
import {
  ExecutionExecutor,
  EventBus,
  reconstructExecution,
  foldExecutionEvents,
} from '../../../packages/engine/src/index.js';
import type {
  WorkflowDefinition,
  ConnectorCapabilities,
  ExecutionEvent,
} from '../../../packages/types/src/index.js';

/** Adapter that always succeeds with a caller-supplied output. */
function outputAdapter(type: string, output: Record<string, unknown>): ConnectorAdapter {
  return {
    type,
    async execute() {
      return { output };
    },
    async healthCheck() {
      return true;
    },
    getCapabilities(): ConnectorCapabilities {
      return { node_types: [`${type}.op`], input_types: ['any'], output_types: ['any'] };
    },
  };
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
    name: 'Replay output test',
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

function node(id: string, type: string): WorkflowDefinition['nodes'][number] {
  return { id, type, position: { x: 0, y: 0 }, config: {} };
}

function event(
  executionId: string,
  seq: number,
  eventType: ExecutionEvent['event_type'],
  nodeId: string | undefined,
  payload: Record<string, unknown> = {},
): ExecutionEvent {
  return {
    id: `${executionId}-${seq}`,
    execution_id: executionId,
    event_type: eventType,
    ...(nodeId !== undefined ? { node_id: nodeId } : {}),
    payload,
    created_at: 1_700_000_000_000 + seq * 1000,
  };
}

describe('replay output persistence (V1.4 M2, F-2)', () => {
  const conns: SqliteConnection[] = [];
  afterEach(() => {
    while (conns.length > 0) conns.pop()!.close();
  });

  it('persists node outputs in node_succeeded events and reconstructs them', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(outputAdapter('alpha', { ok: true, value: 42 }));
    connectors.registerAdapter(outputAdapter('beta', { items: ['x', 'y'] }));

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('node_a', 'alpha.op'), node('node_b', 'beta.op')],
      edges: [{ id: 'e', source: 'node_a', target: 'node_b' }],
      variables: {},
      metadata: { name: 'outputs' },
    };
    const executionId = await seedExecution(store, definition);

    // Generous, explicit cap so both outputs are stored in full.
    const executor = new ExecutionExecutor(store, connectors, 10, 5_000, 30_000, new EventBus(), 5, 65_536);
    await executor.execute(executionId, definition, {});

    // O1: the persisted node_succeeded events carry the output in their payload.
    const events = await store.events.listByExecution(executionId);
    const succeededA = events.find((e) => e.event_type === 'node_succeeded' && e.node_id === 'node_a');
    expect(succeededA?.payload['output']).toEqual({ ok: true, value: 42 });
    expect(typeof succeededA?.payload['duration_ms']).toBe('number');

    // O2: reconstruction folds the persisted output back into the snapshot.
    const snap = await reconstructExecution(store, executionId);
    expect(snap.status).toBe('succeeded');
    expect(snap.nodeStates.get('node_a')).toMatchObject({ status: 'succeeded', output: { ok: true, value: 42 } });
    expect(snap.nodeStates.get('node_b')).toMatchObject({ status: 'succeeded', output: { items: ['x', 'y'] } });
  });

  it('stores an oversized output as a truncated marker (size cap enforced)', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const big = 'x'.repeat(2_000); // serialises well past the 64-byte cap below
    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(outputAdapter('big', { big }));

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('node_big', 'big.op')],
      edges: [],
      variables: {},
      metadata: { name: 'oversized' },
    };
    const executionId = await seedExecution(store, definition);

    // Tiny 64-byte cap forces truncation of the ~2KB output.
    const executor = new ExecutionExecutor(store, connectors, 10, 5_000, 30_000, new EventBus(), 5, 64);
    await executor.execute(executionId, definition, {});

    // The persisted event carries the marker, NOT the full output.
    const events = await store.events.listByExecution(executionId);
    const succeeded = events.find((e) => e.event_type === 'node_succeeded' && e.node_id === 'node_big');
    const payloadOutput = succeeded?.payload['output'] as Record<string, unknown> | undefined;
    expect(payloadOutput?.['__truncated__']).toBe(true);
    expect(typeof payloadOutput?.['size']).toBe('number');
    expect(Number(payloadOutput?.['size'])).toBeGreaterThan(64);
    expect(typeof payloadOutput?.['preview']).toBe('string');
    expect(payloadOutput?.['big']).toBeUndefined(); // full output NOT persisted

    // Reconstruction preserves the truncation marker verbatim.
    const snap = await reconstructExecution(store, executionId);
    expect(snap.nodeStates.get('node_big')).toMatchObject({
      status: 'succeeded',
      output: { __truncated__: true },
    });
  });

  it('folds old events without an output to output === undefined (backward compatible)', () => {
    const execId = 'exec-legacy';
    const events = [
      event(execId, 1, 'execution_started', undefined),
      // Legacy node_succeeded payload: only duration_ms, no output field.
      event(execId, 2, 'node_succeeded', 'node_a', { duration_ms: 12 }),
      event(execId, 3, 'execution_succeeded', undefined),
    ];

    const snap = foldExecutionEvents(execId, events);
    expect(snap.status).toBe('succeeded');
    expect(snap.nodeStates.get('node_a')?.status).toBe('succeeded');
    expect(snap.nodeStates.get('node_a')?.output).toBeUndefined();
  });
});
