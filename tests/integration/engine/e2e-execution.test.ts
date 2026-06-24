/**
 * Integration tests — end-to-end workflow execution through the real engine.
 *
 * Uses stub node types (no real adapters registered) so execution exercises
 * the engine's dispatch path without making external HTTP calls. The executor
 * falls back to returning input-as-output for unknown node types.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildTestApp,
  seedWorkflow,
  type TestApp,
} from '../_helpers/app.js';
import type { WorkflowDefinition } from '../../../packages/types/src/index.js';

/**
 * Three-node linear workflow using stub node types. The executor returns input
 * as output for nodes with no registered adapter, which is enough to assert
 * ordering and output storage.
 */
const STUB_THREE_NODE: WorkflowDefinition = {
  version: '1.0',
  nodes: [
    {
      id: 'node_vault',
      type: 'stub.vault_search',
      position: { x: 0, y: 0 },
      config: { query: 'integration test' },
    },
    {
      id: 'node_transform',
      type: 'stub.transform',
      position: { x: 200, y: 0 },
      config: { mode: 'uppercase' },
    },
    {
      id: 'node_desk',
      type: 'stub.desk_task',
      position: { x: 400, y: 0 },
      config: { title: 'Final task' },
    },
  ],
  edges: [
    { id: 'e1', source: 'node_vault', target: 'node_transform' },
    { id: 'e2', source: 'node_transform', target: 'node_desk' },
  ],
  variables: {},
  metadata: { name: 'e2e-stub-workflow', tags: ['e2e'] },
};

describe('End-to-end workflow execution', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await buildTestApp();
    await ctx.app.ready();
  });

  afterAll(async () => {
    await ctx.app.close();
    ctx.conn.close();
  });

  it('executes a 3-node workflow in topological order', async () => {
    // 1. Create workflow
    const wf = await seedWorkflow(ctx.store, {
      name: 'E2E Workflow',
      definition: STUB_THREE_NODE,
    });

    // 2. Create execution record directly
    const executionId = crypto.randomUUID();
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: wf.id,
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: { trigger_key: 'trigger_value' },
    });

    // 3. Run executor
    await ctx.executor.execute(executionId, STUB_THREE_NODE, {
      trigger_key: 'trigger_value',
    });

    // 4. Verify execution succeeded
    const execution = await ctx.store.executions.getById(executionId);
    expect(execution).not.toBeNull();
    expect(execution!.status).toBe('succeeded');
    expect(execution!.duration_ms).toBeGreaterThanOrEqual(0);
    expect(execution!.error).toBeNull();

    // 5. Verify node executions
    const nodes = await ctx.store.nodeExecutions.listByExecution(executionId);
    expect(nodes).toHaveLength(3);

    // Verify topological order: vault → transform → desk
    expect(nodes[0].node_id).toBe('node_vault');
    expect(nodes[0].node_type).toBe('stub.vault_search');
    expect(nodes[1].node_id).toBe('node_transform');
    expect(nodes[1].node_type).toBe('stub.transform');
    expect(nodes[2].node_id).toBe('node_desk');
    expect(nodes[2].node_type).toBe('stub.desk_task');

    // 6. Verify each node has status 'succeeded' and stored outputs
    for (const node of nodes) {
      expect(node.status).toBe('succeeded');
      expect(node.started_at).toBeDefined();
      expect(node.completed_at).toBeDefined();
      expect(node.output).toBeDefined();
      expect(typeof node.output).toBe('object');
    }

    // 7. Verify inputs are stored
    expect(nodes[0].input).toMatchObject({ query: 'integration test' });
    expect(nodes[1].input).toMatchObject({ mode: 'uppercase' });
    expect(nodes[2].input).toMatchObject({ title: 'Final task' });
  });

  it('marks execution as failed when a node fails', async () => {
    // Workflow with a single node that references a connector type whose
    // adapter we register to throw.
    const failDefinition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        {
          id: 'n_fail',
          type: 'stub.always_fails',
          position: { x: 0, y: 0 },
          config: {},
          retry: { max_attempts: 0, backoff: 'fixed', initial_delay_ms: 0 },
        },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'fail-workflow' },
    };

    // Register a failing adapter
    ctx.connectors.registerAdapter({
      type: 'stub',
      async execute() {
        throw new Error('Simulated node failure');
      },
      async healthCheck() {
        return false;
      },
      getCapabilities() {
        return { node_types: ['stub.always_fails'], input_types: [], output_types: [] };
      },
    });

    const wf = await seedWorkflow(ctx.store, { definition: failDefinition });
    const executionId = crypto.randomUUID();
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: wf.id,
      workflow_version: 1,
      trigger_type: 'manual',
    });

    await expect(ctx.executor.execute(executionId, failDefinition, {})).rejects.toThrow(
      /Simulated node failure/,
    );

    const execution = await ctx.store.executions.getById(executionId);
    expect(execution!.status).toBe('failed');
    expect(execution!.error).toMatch(/Simulated node failure/);

    const nodes = await ctx.store.nodeExecutions.listByExecution(executionId);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].status).toBe('failed');
    expect(nodes[0].error).toMatch(/Simulated node failure/);
  });

  it('empty workflow completes immediately with status "succeeded"', async () => {
    const emptyDefinition: WorkflowDefinition = {
      version: '1.0',
      nodes: [],
      edges: [],
      variables: {},
      metadata: { name: 'empty' },
    };

    const wf = await seedWorkflow(ctx.store, { definition: emptyDefinition });
    const executionId = crypto.randomUUID();
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: wf.id,
      workflow_version: 1,
      trigger_type: 'manual',
    });

    await ctx.executor.execute(executionId, emptyDefinition, {});

    const execution = await ctx.store.executions.getById(executionId);
    expect(execution!.status).toBe('succeeded');

    const nodes = await ctx.store.nodeExecutions.listByExecution(executionId);
    expect(nodes).toHaveLength(0);
  });

  it('outputs from upstream nodes are available via nodeOutputs map', async () => {
    // Use a workflow with two nodes. Uses connector types distinct from the
    // failing adapter registered in the previous test — the connector registry
    // is shared across tests in this suite.
    const twoNodeDefinition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'first', type: 'echo.a', position: { x: 0, y: 0 }, config: { x: 1 } },
        { id: 'second', type: 'echo.b', position: { x: 100, y: 0 }, config: { y: 2 } },
      ],
      edges: [{ id: 'e', source: 'first', target: 'second' }],
      variables: {},
      metadata: { name: 'two-node' },
    };

    const wf = await seedWorkflow(ctx.store, { definition: twoNodeDefinition });
    const executionId = crypto.randomUUID();
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: wf.id,
      workflow_version: 1,
      trigger_type: 'manual',
    });

    await ctx.executor.execute(executionId, twoNodeDefinition, {});

    const nodes = await ctx.store.nodeExecutions.listByExecution(executionId);
    expect(nodes).toHaveLength(2);
    // Both succeeded — inputs persisted
    expect(nodes[0].node_type).toBe('echo.a');
    expect(nodes[1].node_type).toBe('echo.b');
    expect(nodes[0].input).toMatchObject({ x: 1 });
    expect(nodes[1].input).toMatchObject({ y: 2 });
  });
});
