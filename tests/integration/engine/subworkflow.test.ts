/**
 * Integration tests — `workflow.invoke` sub-workflow invocation end-to-end
 * (V1.2 M3, F-Loop-1).
 *
 * Runs through the real engine + SQLite store wired by `buildTestApp`. Child
 * nodes use stub types (input-as-output fallback) so no external HTTP calls are
 * made. Covers the PRD DoD: a parent invokes a child and a downstream parent
 * node consumes the child's output; recursion depth is bounded.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp, seedWorkflow, type TestApp } from '../_helpers/app.js';
import type { WorkflowDefinition } from '../../../packages/types/src/index.js';

/** Structural view of a thrown LoopError (avoids cross-module instanceof). */
interface ThrownLoopError {
  code: string;
  message: string;
}

/** A single stub node that surfaces `trigger.payload.greeting` as its output. */
function stubLeaf(name: string): WorkflowDefinition {
  return {
    version: '1.0',
    nodes: [
      {
        id: 'node_c1',
        type: 'stub.leaf',
        position: { x: 0, y: 0 },
        config: { value: '{{trigger.payload.greeting}}' },
      },
    ],
    edges: [],
    variables: {},
    metadata: { name },
  };
}

/** Wrap `leaf` in `depth` nested `workflow.invoke` definitions (distinct names). */
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

describe('Sub-workflow invocation (workflow.invoke)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await buildTestApp();
    await ctx.app.ready();
  });

  afterAll(async () => {
    await ctx.app.close();
    ctx.conn.close();
  });

  it('parent → child → downstream: consumes the child output end-to-end', async () => {
    const child = stubLeaf('child');
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
          type: 'stub.sink',
          position: { x: 200, y: 0 },
          config: { received: '{{node_sub.output.outputs.node_c1.value}}' },
        },
      ],
      edges: [{ id: 'e1', source: 'node_sub', target: 'node_downstream' }],
      variables: {},
      metadata: { name: 'parent-e2e', tags: ['e2e'] },
    };

    const wf = await seedWorkflow(ctx.store, { name: 'Parent E2E', definition: parent });
    const executionId = crypto.randomUUID();
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: wf.id,
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: {},
    });

    await ctx.executor.execute(executionId, parent, {});

    const execution = await ctx.store.executions.getById(executionId);
    expect(execution?.status).toBe('succeeded');

    const nodes = await ctx.store.nodeExecutions.listByExecution(executionId);
    const invokeRow = nodes.find((n) => n.node_id === 'node_sub');
    const downstreamRow = nodes.find((n) => n.node_id === 'node_downstream');

    // The invoke node returns the child's outputs + status.
    expect(invokeRow?.status).toBe('succeeded');
    expect(invokeRow?.output).toMatchObject({ status: 'succeeded' });
    expect(invokeRow?.output['outputs']).toMatchObject({ node_c1: { value: 'hello-from-parent' } });

    // The downstream parent node consumed the child output via interpolation.
    expect(downstreamRow?.status).toBe('succeeded');
    expect(downstreamRow?.output).toMatchObject({ received: 'hello-from-parent' });

    // The child ran as its own execution row (parent + child = ≥2 executions).
    const all = await ctx.store.executions.list({}, { page: 1, per_page: 50 });
    expect(all.total).toBeGreaterThanOrEqual(2);
  });

  it('invokes a stored sub-workflow by workflow_id', async () => {
    const child = stubLeaf('stored-child');
    const childWf = await seedWorkflow(ctx.store, { name: 'Stored child', definition: child });

    const parent: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        {
          id: 'node_sub',
          type: 'workflow.invoke',
          position: { x: 0, y: 0 },
          config: { workflow_id: childWf.id, inputs: { greeting: 'by-id' } },
        },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'parent-by-id', tags: ['e2e'] },
    };
    const wf = await seedWorkflow(ctx.store, { name: 'Parent by id', definition: parent });
    const executionId = crypto.randomUUID();
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: wf.id,
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: {},
    });

    await ctx.executor.execute(executionId, parent, {});

    const execution = await ctx.store.executions.getById(executionId);
    expect(execution?.status).toBe('succeeded');

    const nodes = await ctx.store.nodeExecutions.listByExecution(executionId);
    const invokeRow = nodes.find((n) => n.node_id === 'node_sub');
    expect(invokeRow?.output['outputs']).toMatchObject({ node_c1: { value: 'by-id' } });
  });

  it('bounds recursion depth with SUBWORKFLOW_DEPTH_EXCEEDED', async () => {
    // 7 nested invokes around a leaf exceeds the default ceiling of 5.
    const definition = nestedInvokeChain(7, stubLeaf('leaf'));
    const wf = await seedWorkflow(ctx.store, { name: 'Deep chain', definition });
    const executionId = crypto.randomUUID();
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: wf.id,
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: {},
    });

    const err = (await ctx.executor.execute(executionId, definition, {}).catch((e: unknown) => e)) as ThrownLoopError;
    expect(err.code).toBe('SUBWORKFLOW_DEPTH_EXCEEDED');
    expect(err.message).toMatch(/exceeds the maximum of 5/);

    const execution = await ctx.store.executions.getById(executionId);
    expect(execution?.status).toBe('failed');
  });
});
