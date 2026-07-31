/**
 * Unit tests — executor → EventBus status fan-out (V1.1 M2, W2).
 *
 * Injects a dedicated EventBus into the executor and asserts that node status
 * transitions (running → succeeded / failed / skipped) and execution lifecycle
 * events are published WITHOUT altering execution behaviour.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSqliteConnection, SqliteStateStore, type SqliteConnection } from '../../../packages/state/src';
import { ConnectorRegistry, type ConnectorAdapter } from '../../../packages/connectors/src';
import { ExecutionExecutor } from '../../../packages/engine/src/executor';
import { EventBus, type ExecutionBusEvent } from '../../../packages/engine/src/eventBus';
import type { WorkflowDefinition, ConnectorCapabilities } from '../../../packages/types/src';

function okAdapter(type: string): ConnectorAdapter {
  return {
    type,
    async execute() {
      return { output: { ok: true } };
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
      throw new Error('adapter exploded');
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
    name: 'EventBus executor test',
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

describe('ExecutionExecutor — EventBus status fan-out', () => {
  const conns: SqliteConnection[] = [];

  afterEach(() => {
    while (conns.length > 0) {
      conns.pop()!.close();
    }
  });

  it('publishes node_started → node_succeeded and execution lifecycle for a passing node', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(okAdapter('vault'));

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('node_a', 'vault.op')],
      edges: [],
      variables: {},
      metadata: { name: 'events-ok' },
    };
    const executionId = await seedExecution(store, definition);

    const bus = new EventBus();
    const events: ExecutionBusEvent[] = [];
    bus.subscribe(executionId, (e) => events.push(e));

    const executor = new ExecutionExecutor(store, connectors, 10, 5_000, 30_000, bus);
    await executor.execute(executionId, definition, {});

    const types = events.map((e) => e.type);
    expect(types).toContain('execution_started');
    expect(types).toContain('node_started');
    expect(types).toContain('node_succeeded');
    expect(types).toContain('execution_succeeded');

    const started = events.find((e) => e.type === 'node_started');
    expect(started?.nodeId).toBe('node_a');
    expect(started?.nodeType).toBe('vault.op');
    expect(started?.status).toBe('running');

    const succeeded = events.find((e) => e.type === 'node_succeeded');
    expect(succeeded?.status).toBe('succeeded');
    expect(succeeded?.output).toMatchObject({ ok: true });
    expect(typeof succeeded?.durationMs).toBe('number');

    // Every event is scoped to this execution.
    expect(events.every((e) => e.executionId === executionId)).toBe(true);
  });

  it('publishes node_failed and execution_failed when a node throws', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(failingAdapter('desk'));

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('node_x', 'desk.op')],
      edges: [],
      variables: {},
      metadata: { name: 'events-fail' },
    };
    const executionId = await seedExecution(store, definition);

    const bus = new EventBus();
    const events: ExecutionBusEvent[] = [];
    bus.subscribe(executionId, (e) => events.push(e));

    const executor = new ExecutionExecutor(store, connectors, 10, 5_000, 30_000, bus);
    await expect(executor.execute(executionId, definition, {})).rejects.toThrow(/adapter exploded/);

    const failed = events.find((e) => e.type === 'node_failed');
    expect(failed?.nodeId).toBe('node_x');
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toMatch(/adapter exploded/);

    const execFailed = events.find((e) => e.type === 'execution_failed');
    expect(execFailed?.status).toBe('failed');
    expect(execFailed?.error).toMatch(/adapter exploded/);
  });

  it('still succeeds with no subscribers attached (publish is a no-op)', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);

    const connectors = new ConnectorRegistry();
    connectors.registerAdapter(okAdapter('vault'));

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('node_a', 'vault.op')],
      edges: [],
      variables: {},
      metadata: { name: 'events-noop' },
    };
    const executionId = await seedExecution(store, definition);

    // A bus with zero subscribers — execution must be unaffected.
    const bus = new EventBus();
    const executor = new ExecutionExecutor(store, connectors, 10, 5_000, 30_000, bus);
    await executor.execute(executionId, definition, {});

    const execution = await store.executions.getById(executionId);
    expect(execution?.status).toBe('succeeded');
  });
});
