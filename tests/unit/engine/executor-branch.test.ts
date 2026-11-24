/**
 * Unit tests — V1.7 branch wiring (L-1), deep interpolation + variables
 * (L-6), control.delay (L-4) and secretResolver (L-2) in the executor.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSqliteConnection, SqliteStateStore, type SqliteConnection } from '../../../packages/state/src';
import { ConnectorRegistry, type ConnectorAdapter } from '../../../packages/connectors/src';
import { ExecutionExecutor } from '../../../packages/engine/src/executor';
import type { WorkflowDefinition, ConnectorCapabilities } from '../../../packages/types/src';
import { LoopError } from '../../../packages/types/src/errors';

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

const contexts: Ctx[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.conn.close();
});

async function seedExecution(store: SqliteStateStore, definition: WorkflowDefinition): Promise<string> {
  const workflowId = `wf-${crypto.randomUUID()}`;
  await store.workflows.create({
    id: workflowId,
    name: 'Branch wiring test',
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

/** Adapter that records every dispatch and returns a canned output. */
function recordingAdapter(type: string, output: Record<string, unknown> = { ok: true }) {
  const dispatches: Array<{ operation: string; input: Record<string, unknown>; secrets?: Record<string, string> }> = [];
  const adapter: ConnectorAdapter = {
    type,
    async execute(params) {
      dispatches.push({
        operation: params.operation,
        input: params.input as Record<string, unknown>,
        ...(params.secrets ? { secrets: params.secrets } : {}),
      });
      // Source nodes pass their category through so branch conditions can
      // reference `{{<node>.output.category}}`.
      if (typeof params.input['category'] === 'string') {
        return { output: { category: params.input['category'] } };
      }
      return { output: { ...output } };
    },
    async healthCheck() {
      return true;
    },
    getCapabilities(): ConnectorCapabilities {
      return { node_types: [`${type}.op`], input_types: ['any'], output_types: ['any'] };
    },
  };
  return { adapter, dispatches };
}

function node(id: string, type: string, config: Record<string, unknown> = {}, x = 0) {
  return { id, type, position: { x, y: 0 }, config };
}

function edge(id: string, source: string, target: string, source_port = 'output') {
  return { id, source, target, source_port };
}

describe('control.branch wiring (L-1)', () => {
  it('executes only the taken branch arm and prunes the other (string literal, quoted)', async () => {
    const ctx = await createStore();
    contexts.push(ctx);
    const connectors = new ConnectorRegistry();
    const { adapter, dispatches } = recordingAdapter('svc');
    connectors.registerAdapter(adapter);
    connectors.registerInstance('svc-1', 'svc', { base_url: 'http://example.test' });

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        node('n_src', 'svc.classify', { category: 'critical' }, 0),
        node('n_branch', 'control.branch', { condition: "{{n_src.output.category}} == 'critical'" }, 1),
        node('n_critical', 'svc.alert', { msg: 'critical path' }, 2),
        node('n_normal', 'svc.log', { msg: 'normal path' }, 2),
      ],
      edges: [
        edge('e1', 'n_src', 'n_branch'),
        edge('e2', 'n_branch', 'n_critical', 'true'),
        edge('e3', 'n_branch', 'n_normal', 'false'),
      ],
      variables: {},
    };
    // Source node emits category=critical → the true arm runs, false arm is skipped.
    (definition.nodes[0]!.config as Record<string, unknown>).__emit = 'critical';
    // recordingAdapter returns the same output for both nodes; make it category-aware:
    const categoryAdapterDispatch = dispatches;
    void categoryAdapterDispatch;

    const execId = await seedExecution(ctx.store, definition);
    const executor = new ExecutionExecutor(ctx.store, connectors, 10, 5_000, 30_000);
    // Make the source node return the category the condition compares against.
    // (The recording adapter returns {ok:true} — patch via trigger instead.)
    await expect(executor.execute(execId, definition, { category: 'critical' })).resolves.toBeTruthy();

    // n_src returned category=critical → the true arm dispatched, false arm
    // was pruned before dispatch (exactly one downstream call).
    const alertRan = dispatches.some((d) => d.input['msg'] === 'critical path');
    const logRan = dispatches.some((d) => d.input['msg'] === 'normal path');
    expect(alertRan).toBe(true);
    expect(logRan).toBe(false);
    expect(dispatches.filter((d) => d.input['msg'])).toHaveLength(1);
  });

  it('records branch decisions and skipped nodes in the store', async () => {
    const ctx = await createStore();
    contexts.push(ctx);
    const connectors = new ConnectorRegistry();
    const { adapter } = recordingAdapter('svc');
    connectors.registerAdapter(adapter);
    connectors.registerInstance('svc-1', 'svc', {});

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        node('b', 'control.branch', { condition: "1 == 2" }, 0),
        node('t', 'svc.op', {}, 1),
        node('f', 'svc.op', {}, 1),
      ],
      edges: [
        edge('e1', 'b', 't', 'true'),
        edge('e2', 'b', 'f', 'false'),
      ],
      variables: {},
    };
    const execId = await seedExecution(ctx.store, definition);
    const executor = new ExecutionExecutor(ctx.store, connectors, 10, 5_000, 30_000);
    await executor.execute(execId, definition, {});

    const rows = await ctx.store.nodeExecutions.listByExecution(execId);
    const byNode = new Map(rows.map((r) => [r.node_id, r.status]));
    expect(byNode.get('b')).toBe('succeeded');
    expect(byNode.get('t')).toBe('skipped'); // 1 == 2 → false
    expect(byNode.get('f')).toBe('succeeded');
  });

  it('supports {{trigger.payload.*}} and {{variables.*}} in conditions', async () => {
    const ctx = await createStore();
    contexts.push(ctx);
    const connectors = new ConnectorRegistry();
    const { adapter, dispatches } = recordingAdapter('svc');
    connectors.registerAdapter(adapter);
    connectors.registerInstance('svc-1', 'svc', {});

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        node('b', 'control.branch', { condition: "{{trigger.payload.severity}} == 'high' && {{variables.env}} == 'prod'" }, 0),
        node('t', 'svc.op', {}, 1),
        node('f', 'svc.op', {}, 1),
      ],
      edges: [
        edge('e1', 'b', 't', 'true'),
        edge('e2', 'b', 'f', 'false'),
      ],
      variables: { env: { type: 'string', default: 'prod' } },
    };
    const execId = await seedExecution(ctx.store, definition);
    const executor = new ExecutionExecutor(ctx.store, connectors, 10, 5_000, 30_000);
    await executor.execute(execId, definition, { severity: 'high' });

    const rows = await ctx.store.nodeExecutions.listByExecution(execId);
    const byNode = new Map(rows.map((r) => [r.node_id, r.status]));
    expect(byNode.get('t')).toBe('succeeded');
    expect(byNode.get('f')).toBe('skipped');
    expect(dispatches.length).toBe(1); // only the true arm dispatched
  });

  it('pruning cascades past intermediate nodes', async () => {
    const ctx = await createStore();
    contexts.push(ctx);
    const connectors = new ConnectorRegistry();
    const { adapter } = recordingAdapter('svc');
    connectors.registerAdapter(adapter);
    connectors.registerInstance('svc-1', 'svc', {});

    // b(false) → mid → leaf : leaf must be skipped even though its direct
    // predecessor (mid) is itself skipped, not a branch node.
    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        node('b', 'control.branch', { condition: 'false' }, 0),
        node('mid', 'svc.op', {}, 1),
        node('leaf', 'svc.op', {}, 2),
      ],
      edges: [
        edge('e1', 'b', 'mid', 'true'),
        edge('e2', 'mid', 'leaf'),
      ],
      variables: {},
    };
    const execId = await seedExecution(ctx.store, definition);
    const executor = new ExecutionExecutor(ctx.store, connectors, 10, 5_000, 30_000);
    await executor.execute(execId, definition, {});

    const rows = await ctx.store.nodeExecutions.listByExecution(execId);
    const byNode = new Map(rows.map((r) => [r.node_id, r.status]));
    expect(byNode.get('mid')).toBe('skipped');
    expect(byNode.get('leaf')).toBe('skipped');
  });
});

describe('control.delay (L-4)', () => {
  it('waits for the configured duration and reports delayed_ms', async () => {
    const ctx = await createStore();
    contexts.push(ctx);
    const connectors = new ConnectorRegistry();
    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('d', 'control.delay', { duration_ms: 50 }, 0)],
      edges: [],
      variables: {},
    };
    const execId = await seedExecution(ctx.store, definition);
    const executor = new ExecutionExecutor(ctx.store, connectors, 10, 5_000, 30_000);
    const started = Date.now();
    await executor.execute(execId, definition, {});
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
    const rows = await ctx.store.nodeExecutions.listByExecution(execId);
    expect(rows[0]!.status).toBe('succeeded');
    expect((rows[0]!.output as Record<string, unknown>)['delayed_ms']).toBe(50);
  });

  it('rejects a non-numeric duration', async () => {
    const ctx = await createStore();
    contexts.push(ctx);
    const connectors = new ConnectorRegistry();
    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('d', 'control.delay', { duration_ms: 'later' }, 0)],
      edges: [],
      variables: {},
    };
    const execId = await seedExecution(ctx.store, definition);
    const executor = new ExecutionExecutor(ctx.store, connectors, 10, 5_000, 30_000);
    await expect(executor.execute(execId, definition, {})).rejects.toThrow(/duration_ms/);
  });
});

describe('deep interpolation + variables (L-6)', () => {
  it('interpolates nested objects and arrays, and variables.* references', async () => {
    const ctx = await createStore();
    contexts.push(ctx);
    const connectors = new ConnectorRegistry();
    const { adapter, dispatches } = recordingAdapter('svc');
    connectors.registerAdapter(adapter);
    connectors.registerInstance('svc-1', 'svc', {});

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        node('n', 'svc.op', {
          body: {
            to: '{{trigger.payload.email}}',
            vars: { env: '{{variables.env}}', cart: '{{trigger.payload.cart_id}}' },
            tags: ['a', '{{trigger.payload.tag}}'],
          },
        }, 0),
      ],
      edges: [],
      variables: { env: { type: 'string', default: 'prod' } },
    };
    const execId = await seedExecution(ctx.store, definition);
    const executor = new ExecutionExecutor(ctx.store, connectors, 10, 5_000, 30_000);
    await executor.execute(execId, definition, { email: 'a@b.c', cart_id: 'c-9', tag: 'vip' });

    expect(dispatches[0]!.input['body']).toEqual({
      to: 'a@b.c',
      vars: { env: 'prod', cart: 'c-9' },
      tags: ['a', 'vip'],
    });
  });
});

describe('secretResolver (L-2)', () => {
  it('resolves api_key via the resolver before the inline config', async () => {
    const ctx = await createStore();
    contexts.push(ctx);
    const connectors = new ConnectorRegistry();
    const { adapter, dispatches } = recordingAdapter('svc');
    connectors.registerAdapter(adapter);
    connectors.registerInstance('svc-1', 'svc', { api_key: 'inline-key' });

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('n', 'svc.op', { x: '1' }, 0)],
      edges: [],
      variables: {},
    };
    const execId = await seedExecution(ctx.store, definition);
    const executor = new ExecutionExecutor(
      ctx.store,
      connectors,
      10,
      5_000,
      30_000,
      undefined, // eventBus
      undefined, // maxSubWorkflowDepth
      undefined, // eventOutputMaxBytes
      undefined, // egressGate
      async () => 'encrypted-store-key', // secretResolver wins
    );
    await executor.execute(execId, definition, {});
    expect(dispatches[0]!.secrets).toEqual({ api_key: 'encrypted-store-key' });
  });

  it('falls back to the inline config when the resolver returns null', async () => {
    const ctx = await createStore();
    contexts.push(ctx);
    const connectors = new ConnectorRegistry();
    const { adapter, dispatches } = recordingAdapter('svc');
    connectors.registerAdapter(adapter);
    connectors.registerInstance('svc-1', 'svc', { api_key: 'inline-key' });

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('n', 'svc.op', { x: '1' }, 0)],
      edges: [],
      variables: {},
    };
    const execId = await seedExecution(ctx.store, definition);
    const executor = new ExecutionExecutor(
      ctx.store,
      connectors,
      10,
      5_000,
      30_000,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => null,
    );
    await executor.execute(execId, definition, {});
    expect(dispatches[0]!.secrets).toEqual({ api_key: 'inline-key' });
  });
});

describe('defaultRetry (L-9)', () => {
  it('applies the executor-wide default retry to nodes without an explicit retry', async () => {
    const ctx = await createStore();
    contexts.push(ctx);
    const connectors = new ConnectorRegistry();
    let attempts = 0;
    const flaky: ConnectorAdapter = {
      type: 'svc',
      async execute() {
        attempts += 1;
        if (attempts < 3) throw new Error('transient');
        return { output: { ok: true } };
      },
      async healthCheck() {
        return true;
      },
      getCapabilities(): ConnectorCapabilities {
        return { node_types: ['svc.op'], input_types: ['any'], output_types: ['any'] };
      },
    };
    connectors.registerAdapter(flaky);
    connectors.registerInstance('svc-1', 'svc', {});

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('n', 'svc.op', {}, 0)],
      edges: [],
      variables: {},
    };
    const execId = await seedExecution(ctx.store, definition);
    const executor = new ExecutionExecutor(
      ctx.store,
      connectors,
      10,
      5_000,
      30_000,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { max_attempts: 3, backoff: 'fixed', initial_delay_ms: 1 },
    );
    await executor.execute(execId, definition, {});
    expect(attempts).toBe(3); // 1 initial + 2 retries from the default
  });

  it('audit #9: resume after a failed run reuses pruned-node rows (no UNIQUE collision)', async () => {
    const ctx = await createStore();
    contexts.push(ctx);
    const connectors = new ConnectorRegistry();
    const dispatches: string[] = [];
    let failAlert = true;
    const adapter: ConnectorAdapter = {
      type: 'svc',
      async execute(params) {
        dispatches.push(params.operation);
        if (params.operation === 'classify') return { output: { category: 'critical' } };
        if (params.operation === 'alert' && failAlert) throw new Error('alert transient failure');
        return { output: { ok: true } };
      },
      async healthCheck() {
        return true;
      },
      getCapabilities(): ConnectorCapabilities {
        return { node_types: ['svc.classify', 'svc.alert', 'svc.log'], input_types: ['any'], output_types: ['any'] };
      },
    };
    connectors.registerAdapter(adapter);

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        node('n_src', 'svc.classify', {}, 0),
        node('n_branch', 'control.branch', { condition: "{{n_src.output.category}} == 'critical'" }, 1),
        node('n_critical', 'svc.alert', {}, 2),
        node('n_normal', 'svc.log', {}, 2),
      ],
      edges: [
        edge('e1', 'n_src', 'n_branch'),
        edge('e2', 'n_branch', 'n_critical', 'true'),
        edge('e3', 'n_branch', 'n_normal', 'false'),
      ],
      variables: {},
    };
    const execId = await seedExecution(ctx.store, definition);
    const executor = new ExecutionExecutor(ctx.store, connectors, 10, 5_000, 30_000);

    // First run: the taken arm fails; the false arm is pruned ('skipped' row).
    await expect(executor.execute(execId, definition, {})).rejects.toThrow();
    const skippedRow = await ctx.store.nodeExecutions.findByIdempotencyKey(`${execId}:n_normal`);
    expect(skippedRow?.status).toBe('skipped');

    // Resume the SAME execution: pruning must reuse the skipped row instead of
    // re-inserting it (which violated idx_node_exec_idem and failed the run).
    failAlert = false;
    await executor.execute(execId, definition, {});
    const execution = await ctx.store.executions.getById(execId);
    expect(execution?.status).toBe('succeeded');
    expect(dispatches.filter((o) => o === 'log')).toHaveLength(0);
    expect(dispatches.filter((o) => o === 'alert')).toHaveLength(2);
  });

  it('audit #15: executor forwards the egress gate to adapters; a denying gate fails the node', async () => {
    const ctx = await createStore();
    contexts.push(ctx);
    const connectors = new ConnectorRegistry();
    let receivedEgress: unknown;
    let checkCalledWith: string | undefined;
    const adapter: ConnectorAdapter = {
      type: 'svc',
      async execute(params) {
        receivedEgress = params.egress;
        checkCalledWith = 'http://blocked.example.test/api';
        await params.egress?.check(checkCalledWith);
        return { output: { ok: true } };
      },
      async healthCheck() {
        return true;
      },
      getCapabilities(): ConnectorCapabilities {
        return { node_types: ['svc.op'], input_types: ['any'], output_types: ['any'] };
      },
    };
    connectors.registerAdapter(adapter);

    const gate = {
      async check(_url: string): Promise<void> {
        throw new LoopError('NODE_EGRESS_BLOCKED', 'Egress blocked: test deny', 403);
      },
    };
    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('n1', 'svc.op')],
      edges: [],
      variables: {},
    };
    const execId = await seedExecution(ctx.store, definition);
    // 9th constructor argument is the egress gate (server.ts wiring order).
    const executor = new ExecutionExecutor(
      ctx.store, connectors, 10, 5_000, 30_000, undefined, undefined, undefined, gate as never,
    );

    await expect(executor.execute(execId, definition, {})).rejects.toThrow(/Egress blocked/);
    // The adapter actually received the gate instance and consulted it.
    expect(receivedEgress).toBe(gate);
    expect(checkCalledWith).toBe('http://blocked.example.test/api');
    const execution = await ctx.store.executions.getById(execId);
    expect(execution?.status).toBe('failed');
  });
});

describe('connector instance selection (audit #44)', () => {
  it('honors config.connector_instance_id over the first-registered instance', async () => {
    const ctx = await createStore();
    contexts.push(ctx);
    const connectors = new ConnectorRegistry();
    const seenConfigs: Record<string, unknown>[] = [];
    const adapter: ConnectorAdapter = {
      type: 'svc',
      async execute(params) {
        seenConfigs.push(params.config as Record<string, unknown>);
        return { output: { ok: true } };
      },
      async healthCheck() {
        return true;
      },
      getCapabilities(): ConnectorCapabilities {
        return { node_types: ['svc.op'], input_types: ['any'], output_types: ['any'] };
      },
    };
    connectors.registerAdapter(adapter);
    connectors.registerInstance('svc-env', 'svc', { base_url: 'http://first.test' });
    connectors.registerInstance('svc-db', 'svc', { base_url: 'http://second.test' });

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('n1', 'svc.op', { connector_instance_id: 'svc-db' })],
      edges: [],
      variables: {},
    };
    const execId = await seedExecution(ctx.store, definition);
    const executor = new ExecutionExecutor(ctx.store, connectors, 10, 5_000, 30_000);
    await executor.execute(execId, definition, {});
    expect(seenConfigs[0]!['base_url']).toBe('http://second.test');
  });
});
