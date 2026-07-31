/**
 * Unit tests — `workflow.invoke` sub-workflow invocation (V1.2 M3, F-Loop-1).
 *
 * Verifies the engine-built-in node (NOT a connector):
 *   - S1: a parent invokes an inline child that runs on the same executor and
 *         returns `{ outputs, status: 'succeeded' }`; a failing child fails the
 *         parent node.
 *   - S2: recursion is bounded by `maxSubWorkflowDepth` (SUBWORKFLOW_DEPTH_EXCEEDED),
 *         plus a visited-set cycle guard for self-invoking workflows.
 *   - S3: parent `input.inputs` maps onto the child `trigger.payload`, and the
 *         child's outputs are reachable by a downstream parent node via the
 *         usual `{{node_X.output.*}}` interpolation.
 *   - S4: every child event is tagged with `parentExecutionId` on the shared bus.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSqliteConnection, SqliteStateStore, type SqliteConnection } from '../../../packages/state/src';
import { ConnectorRegistry, type ConnectorAdapter } from '../../../packages/connectors/src';
import { ExecutionExecutor } from '../../../packages/engine/src/executor';
import { EventBus, type ExecutionBusEvent } from '../../../packages/engine/src/eventBus';
import { LoopError } from '../../../packages/types/src/errors';
import type { WorkflowDefinition, ConnectorCapabilities } from '../../../packages/types/src';

/** Recording adapter: captures every resolved input, echoes a `value` output. */
function recordingAdapter(type: string, calls: Record<string, unknown>[]): ConnectorAdapter {
  return {
    type,
    async execute({ input }) {
      calls.push(input);
      const value = input['echo'] ?? input['received'] ?? null;
      return { output: { value, ok: true } };
    },
    async healthCheck() {
      return true;
    },
    getCapabilities(): ConnectorCapabilities {
      return { node_types: [`${type}.op`], input_types: ['any'], output_types: ['any'] };
    },
  };
}

function failingAdapter(type: string): ConnectorAdapter {
  return {
    type,
    async execute() {
      throw new Error('child adapter exploded');
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
    name: 'Sub-workflow unit test',
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

/** A single mock-connector node that echoes `trigger.payload.greeting`. */
function leafDefinition(name: string): WorkflowDefinition {
  return {
    version: '1.0',
    nodes: [
      {
        id: 'node_c1',
        type: 'mock.op',
        position: { x: 0, y: 0 },
        config: { echo: '{{trigger.payload.greeting}}' },
      },
    ],
    edges: [],
    variables: {},
    metadata: { name },
  };
}

/**
 * Wrap `leaf` in `depth` nested `workflow.invoke` definitions (distinct names so
 * the cycle guard does not fire — only the depth ceiling does). The outermost
 * wrapper is what the test executes as the root.
 */
function nestedInvokeChain(depth: number, leaf: WorkflowDefinition): WorkflowDefinition {
  let current = leaf;
  for (let i = 0; i < depth; i++) {
    current = {
      version: '1.0',
      nodes: [
        {
          id: 'node_invoke',
          type: 'workflow.invoke',
          position: { x: 0, y: 0 },
          config: { definition: current },
        },
      ],
      edges: [],
      variables: {},
      metadata: { name: `chain-${i}` },
    };
  }
  return current;
}

describe('ExecutionExecutor — workflow.invoke sub-workflows (V1.2 M3)', () => {
  const conns: SqliteConnection[] = [];

  afterEach(() => {
    while (conns.length > 0) {
      conns.pop()!.close();
    }
  });

  it('S1/S3: invokes an inline child, maps inputs, and exposes child outputs downstream', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const calls: Record<string, unknown>[] = [];
    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(recordingAdapter('mock', calls));

    const child = leafDefinition('child');
    const parent: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        {
          id: 'node_sub',
          type: 'workflow.invoke',
          position: { x: 0, y: 0 },
          config: { definition: child, inputs: { greeting: 'hello-from-parent' } },
        },
        {
          id: 'node_downstream',
          type: 'mock.op',
          position: { x: 200, y: 0 },
          config: { received: '{{node_sub.output.outputs.node_c1.value}}' },
        },
      ],
      edges: [{ id: 'e1', source: 'node_sub', target: 'node_downstream' }],
      variables: {},
      metadata: { name: 'parent' },
    };
    const executionId = await seedExecution(store, parent);

    const executor = new ExecutionExecutor(store, connectors, 10, 5_000);
    await executor.execute(executionId, parent, {});

    const execution = await store.executions.getById(executionId);
    expect(execution?.status).toBe('succeeded');

    // S3 input mapping: the child node saw the parent-supplied payload value.
    expect(calls).toContainEqual({ echo: 'hello-from-parent' });
    // S3 output return: the downstream parent node consumed the child output
    // via {{node_sub.output.outputs.node_c1.value}} interpolation.
    expect(calls).toContainEqual({ received: 'hello-from-parent' });

    // The invoke node's stored output carries the child's outputs + status.
    const nodeExecs = await store.nodeExecutions.listByExecution(executionId);
    const invokeRow = nodeExecs.find((n) => n.node_id === 'node_sub');
    expect(invokeRow?.status).toBe('succeeded');
    expect(invokeRow?.output).toMatchObject({ status: 'succeeded' });
    expect(invokeRow?.output['outputs']).toMatchObject({ node_c1: { value: 'hello-from-parent' } });

    // The child ran as its own execution (a separate execution row exists).
    const allExecutions = await store.executions.list({}, { page: 1, per_page: 10 });
    expect(allExecutions.total).toBeGreaterThanOrEqual(2);
  });

  it('S1: a failing child fails the parent node and the execution', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(failingAdapter('mock'));

    const child = leafDefinition('failing-child');
    const parent: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        {
          id: 'node_sub',
          type: 'workflow.invoke',
          position: { x: 0, y: 0 },
          config: { definition: child, inputs: { greeting: 'x' } },
        },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'parent-fail' },
    };
    const executionId = await seedExecution(store, parent);

    const executor = new ExecutionExecutor(store, connectors, 10, 5_000);
    await expect(executor.execute(executionId, parent, {})).rejects.toThrow(/child adapter exploded/);

    const execution = await store.executions.getById(executionId);
    expect(execution?.status).toBe('failed');
  });

  it('S2: exceeding maxSubWorkflowDepth throws SUBWORKFLOW_DEPTH_EXCEEDED', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(recordingAdapter('mock', []));

    // 5 nested invokes around a leaf, but the executor caps recursion at 2.
    const definition = nestedInvokeChain(5, leafDefinition('leaf'));
    const executionId = await seedExecution(store, definition);

    const executor = new ExecutionExecutor(store, connectors, 10, 5_000, 30_000, new EventBus(), 2);
    const err = await executor.execute(executionId, definition, {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LoopError);
    expect((err as LoopError).code).toBe('SUBWORKFLOW_DEPTH_EXCEEDED');
    expect((err as LoopError).message).toMatch(/exceeds the maximum of 2/);

    const execution = await store.executions.getById(executionId);
    expect(execution?.status).toBe('failed');
  });

  it('S2: a self-invoking stored workflow is stopped by the cycle guard', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(recordingAdapter('mock', []));

    const workflowId = `wf-${crypto.randomUUID()}`;
    const selfDef: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        {
          id: 'node_loop',
          type: 'workflow.invoke',
          position: { x: 0, y: 0 },
          config: { workflow_id: workflowId },
        },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'self-invoking' },
    };
    await store.workflows.create({
      id: workflowId,
      name: 'self-invoking',
      description: '',
      definition: selfDef,
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

    const executor = new ExecutionExecutor(store, connectors, 10, 5_000);
    const err = await executor.execute(executionId, selfDef, {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LoopError);
    expect((err as LoopError).code).toBe('SUBWORKFLOW_DEPTH_EXCEEDED');
    expect((err as LoopError).message).toMatch(/cycle detected/);
  });

  it('S4: tags every child event with parentExecutionId on the shared bus', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const calls: Record<string, unknown>[] = [];
    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(recordingAdapter('mock', calls));

    const child = leafDefinition('child-events');
    const parent: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        {
          id: 'node_sub',
          type: 'workflow.invoke',
          position: { x: 0, y: 0 },
          config: { definition: child, inputs: { greeting: 'hi' } },
        },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'parent-events' },
    };
    const executionId = await seedExecution(store, parent);

    const bus = new EventBus();
    const all: ExecutionBusEvent[] = [];
    const original = bus.publish.bind(bus);
    bus.publish = (event: ExecutionBusEvent): void => {
      all.push(event);
      original(event);
    };

    const executor = new ExecutionExecutor(store, connectors, 10, 5_000, 30_000, bus);
    await executor.execute(executionId, parent, {});

    // Child events are tagged with the parent execution id...
    const childEvents = all.filter((e) => e.parentExecutionId === executionId);
    expect(childEvents.length).toBeGreaterThan(0);
    expect(childEvents.some((e) => e.type === 'execution_started')).toBe(true);
    expect(childEvents.some((e) => e.type === 'node_succeeded')).toBe(true);
    // ...and belong to a DIFFERENT (child) execution.
    expect(childEvents.every((e) => e.executionId !== executionId)).toBe(true);

    // Root events are NOT tagged with a parent.
    const rootStarted = all.find((e) => e.type === 'execution_started' && e.executionId === executionId);
    expect(rootStarted?.parentExecutionId).toBeUndefined();
  });
});
