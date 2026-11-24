/**
 * Integration tests — recovery dispatches the stamped version (audit #21).
 *
 * A workflow edited between crash and restart must resume against the
 * execution's workflow_version snapshot, not the live (newer) definition.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp, type TestApp } from '../_helpers/app.js';
import type { ConnectorAdapter, ConnectorCapabilities } from '../../../packages/connectors/src';
import type { WorkflowDefinition } from '../../../packages/types/src';

function def(echo: string): WorkflowDefinition {
  return {
    version: '1.0',
    nodes: [{ id: 'n1', type: 'mock.op', position: { x: 0, y: 0 }, config: { echo } }],
    edges: [],
    variables: {},
    metadata: { name: 'version-dispatch' },
  };
}

describe('Recovery version dispatch (audit #21)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await buildTestApp();
    await ctx.app.ready();
    const adapter: ConnectorAdapter = {
      type: 'mock',
      async execute({ input }) {
        return { output: { value: (input as Record<string, unknown>)['echo'] ?? null } };
      },
      async healthCheck() {
        return true;
      },
      getCapabilities(): ConnectorCapabilities {
        return { node_types: ['mock.op'], input_types: ['any'], output_types: ['any'] };
      },
    };
    ctx.connectors.registerAdapter(adapter);
  });

  afterAll(async () => {
    await ctx.app.close();
    ctx.conn.close();
  });

  it('resumes a pending execution against its stamped v1 snapshot after the workflow moved to v2', async () => {
    const workflowId = crypto.randomUUID();
    await ctx.store.workflows.create({
      id: workflowId,
      name: 'Version dispatch',
      description: '',
      definition: def('old'),
      created_by: 'system',
    });
    await ctx.store.workflowDefinitions.create({
      id: crypto.randomUUID(),
      workflow_id: workflowId,
      version: 1,
      definition: def('old'),
      commit_hash: 'test-hash',
      created_by: 'system',
    });
    // The workflow is edited AFTER the execution was stamped.
    await ctx.store.workflows.update(workflowId, { definition: def('new'), updated_by: 'system' });

    const executionId = crypto.randomUUID();
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: workflowId,
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: {},
    });

    await ctx.recovery.recover();

    // Wait for the re-dispatched execution to settle.
    const start = Date.now();
    let status = 'pending';
    while (Date.now() - start < 3000) {
      const ex = await ctx.store.executions.getById(executionId);
      status = ex?.status ?? 'pending';
      if (status !== 'pending' && status !== 'running') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(status).toBe('succeeded');

    const nodes = await ctx.store.nodeExecutions.listByExecution(executionId);
    expect(nodes[0]?.output).toEqual({ value: 'old' });
  });
});
