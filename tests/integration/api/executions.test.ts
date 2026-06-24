/**
 * Integration tests — execution flow via HTTP (TSD §5.4).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { WorkflowDefinition } from '../../../packages/types/src/index.js';
import {
  buildTestApp,
  seedWorkflow,
  SYSTEM_USER_ID,
  type TestApp,
} from '../_helpers/app.js';

/**
 * Three-node linear workflow using *stub* node types. The executor falls back
 * to returning input-as-output for nodes whose connector type is not
 * registered, so this avoids real HTTP calls to Vault/Desk adapters.
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
  metadata: { name: 'stub-e2e-workflow', tags: ['e2e'] },
};

describe('Execution API', () => {
  let ctx: TestApp;
  let app: FastifyInstance;

  beforeAll(async () => {
    ctx = await buildTestApp();
    app = ctx.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    ctx.conn.close();
  });

  // ── POST /api/v1/workflows/:id/execute ────────────────────────────────────

  it('POST /api/v1/workflows/:id/execute triggers a manual execution (202)', async () => {
    const wf = await seedWorkflow(ctx.store);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.id}/execute`,
      payload: { payload: { key: 'value' } },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.execution_id).toBeDefined();
    expect(typeof body.data.execution_id).toBe('string');
    expect(body.data.status).toBe('pending');

    // Execution should exist in the DB as 'pending'
    const dbExecution = await ctx.store.executions.getById(body.data.execution_id);
    expect(dbExecution).toBeDefined();
    expect(dbExecution!.workflow_id).toBe(wf.id);
    expect(dbExecution!.trigger_type).toBe('manual');
    expect(dbExecution!.status).toBe('pending');
    expect(dbExecution!.trigger_payload).toEqual({ key: 'value' });
  });

  it('POST execute fails for unknown workflow id (FK violation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/00000000-0000-0000-0000-999999999999/execute',
      payload: {},
    });

    // The route does not pre-validate the workflow id. SQLite rejects the
    // insert because workflow_executions.workflow_id references workflows(id),
    // resulting in an unhandled 500. A future improvement would be to
    // validate the workflow exists and return 404.
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    const body = res.json();
    expect(body.success).toBe(false);
  });

  // ── GET /api/v1/executions/:id ────────────────────────────────────────────

  it('GET /api/v1/executions/:id returns execution with node results', async () => {
    const wf = await seedWorkflow(ctx.store, { definition: STUB_THREE_NODE });

    // Trigger execution
    const execRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.id}/execute`,
      payload: {},
    });
    const executionId = execRes.json().data.execution_id;

    // Seed some node executions to simulate partial progress
    const node1 = await ctx.store.nodeExecutions.create({
      id: crypto.randomUUID(),
      execution_id: executionId,
      node_id: 'node_vault',
      node_type: 'stub.vault_search',
      input: { query: 'hello' },
    });
    await ctx.store.nodeExecutions.updateStatus(node1.id, {
      status: 'succeeded',
      output: { documents: [{ id: 'd1', title: 'Found' }] },
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/executions/${executionId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(executionId);
    expect(body.data.workflow_id).toBe(wf.id);
    expect(Array.isArray(body.data.nodes)).toBe(true);
    expect(body.data.nodes).toHaveLength(1);
    expect(body.data.nodes[0].node_type).toBe('stub.vault_search');
    expect(body.data.nodes[0].status).toBe('succeeded');
    expect(body.data.nodes[0].output.documents).toHaveLength(1);
  });

  // ── GET /api/v1/executions (list) ─────────────────────────────────────────

  it('GET /api/v1/executions lists executions with filter', async () => {
    const wf1 = await seedWorkflow(ctx.store, { name: 'WF-1' });
    const wf2 = await seedWorkflow(ctx.store, { name: 'WF-2' });

    // Create executions for each workflow
    await ctx.store.executions.create({
      id: crypto.randomUUID(),
      workflow_id: wf1.id,
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: {},
    });
    await ctx.store.executions.create({
      id: crypto.randomUUID(),
      workflow_id: wf1.id,
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: {},
    });
    await ctx.store.executions.create({
      id: crypto.randomUUID(),
      workflow_id: wf2.id,
      workflow_version: 1,
      trigger_type: 'cron',
      trigger_payload: {},
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/executions?workflow_id=${wf1.id}`,
    });

    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta.total).toBe(2);
  });

  // ── POST /api/v1/executions/:id/cancel ────────────────────────────────────

  it('POST /api/v1/executions/:id/cancel sets status to cancelled', async () => {
    const wf = await seedWorkflow(ctx.store);
    const exec = await ctx.store.executions.create({
      id: crypto.randomUUID(),
      workflow_id: wf.id,
      workflow_version: 1,
      trigger_type: 'manual',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/executions/${exec.id}/cancel`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('cancelled');

    // Confirm DB state
    const updated = await ctx.store.executions.getById(exec.id);
    expect(updated!.status).toBe('cancelled');
  });

  // ── End-to-end: trigger → execute → observe ───────────────────────────────

  it('full cycle: create workflow, trigger execution, run executor, verify nodes', async () => {
    const wf = await seedWorkflow(ctx.store, { definition: STUB_THREE_NODE });

    // 1. Trigger execution
    const triggerRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.id}/execute`,
      payload: { payload: { input: 'data' } },
    });
    const executionId = triggerRes.json().data.execution_id;

    // 2. Manually run the executor (in production this is event-driven)
    await ctx.executor.execute(executionId, STUB_THREE_NODE, { input: 'data' });

    // 3. Fetch execution
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/executions/${executionId}`,
    });

    const body = res.json();
    expect(body.data.status).toBe('succeeded');
    expect(body.data.nodes.length).toBe(3);

    // Verify execution order (node_executions should be in topological order)
    const nodeTypes = body.data.nodes.map((n: { node_type: string }) => n.node_type);
    expect(nodeTypes).toEqual(['stub.vault_search', 'stub.transform', 'stub.desk_task']);

    // Verify all nodes have output stored
    for (const node of body.data.nodes) {
      expect(node.status).toBe('succeeded');
      expect(node.output).toBeDefined();
    }
  });
});
