/**
 * E2E — Crash recovery resumes from the last successful node (V1.1 M1, F1/F2).
 *
 * Scenario:
 *   1. Create a 3-node linear workflow (recap → vault → desk) and an execution.
 *   2. Simulate a crash mid-way: the execution is left `running` with only the
 *      first node `succeeded` (as if the process died before node 2 ran).
 *   3. Run recovery → the execution is reset to `pending` and an
 *      `execution_recovered` event is appended.
 *   4. Re-execute → the engine resumes from the breakpoint: the succeeded node
 *      is SKIPPED (its connector is NOT re-invoked) and only the remaining
 *      nodes run, with downstream interpolation reusing the cached output.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTestContext,
  createNode,
  createEdge,
  type TestContext,
} from './helpers';
import type { WorkflowDefinition } from '../../packages/types/src';

function crashRecoveryDefinition(): WorkflowDefinition {
  return {
    version: '1.0',
    nodes: [
      createNode('node_1', 'recap.get_meeting', { id: 'm1' }),
      createNode('node_2', 'vault.create_document', {
        title: 'Meeting summary',
        content: '{{node_1.output.summary}}',
      }),
      createNode('node_3', 'desk.send_response', {
        id: 'conv-1',
        content: '{{node_1.output.summary}}',
      }),
    ],
    edges: [createEdge('node_1', 'node_2'), createEdge('node_2', 'node_3')],
    variables: {},
    metadata: { name: 'crash-recovery', description: 'Resume from breakpoint' },
  };
}

describe('Crash recovery — resume from last successful node (E2E)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('resumes an interrupted execution and only dispatches not-yet-succeeded nodes', async () => {
    const definition = crashRecoveryDefinition();
    const workflowId = 'wf-crash-recovery';
    await ctx.store.workflows.create({
      id: workflowId,
      name: 'Crash recovery',
      description: '',
      definition,
      created_by: 'system',
      tags: ['e2e'],
    });

    const executionId = 'exec-crash-1';
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: workflowId,
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: {},
    });

    // ── Simulate a crash mid-way ──────────────────────────────────────────
    // The execution was running and node_1 had succeeded before the process died.
    await ctx.store.executions.updateStatus(executionId, {
      status: 'running',
      started_at: new Date().toISOString(),
    });
    const node1ExecId = 'ne-node-1';
    await ctx.store.nodeExecutions.create({
      id: node1ExecId,
      execution_id: executionId,
      node_id: 'node_1',
      node_type: 'recap.get_meeting',
      input: { id: 'm1' },
      idempotency_key: `${executionId}:node_1`,
    });
    await ctx.store.nodeExecutions.updateStatus(node1ExecId, {
      status: 'succeeded',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      output: { id: 'm1', summary: 'Discuss Q3 budget' },
    });

    // ── Recovery: reset to pending + record event ─────────────────────────
    const result = await ctx.recovery.recover();
    expect(result.recovered).toBe(1);

    const recoveredExec = await ctx.store.executions.getById(executionId);
    expect(recoveredExec?.status).toBe('pending');

    const recoveredEvents = await ctx.store.events.listByExecution(executionId);
    expect(
      recoveredEvents.some((e) => e.event_type === 'execution_recovered'),
    ).toBe(true);

    // ── Re-execute: resume from the breakpoint ────────────────────────────
    await ctx.executor.execute(executionId, definition, {});

    const execution = await ctx.store.executions.getById(executionId);
    expect(execution?.status).toBe('succeeded');

    // The succeeded node's connector (recap) was NOT re-invoked; only the
    // not-yet-succeeded nodes (vault, desk) were dispatched exactly once.
    expect(ctx.mocks.recap.calls).toHaveLength(0);
    expect(ctx.mocks.vault.calls).toHaveLength(1);
    expect(ctx.mocks.desk.calls).toHaveLength(1);

    // Downstream interpolation reused the cached node_1 output (resume basis).
    expect(ctx.mocks.vault.calls[0]!.input).toMatchObject({ content: 'Discuss Q3 budget' });
    expect(ctx.mocks.desk.calls[0]!.input).toMatchObject({ content: 'Discuss Q3 budget' });

    // The idempotency key was forwarded to the dispatched connectors.
    expect(ctx.mocks.vault.calls[0]!.idempotencyKey).toBe(`${executionId}:node_2`);
    expect(ctx.mocks.desk.calls[0]!.idempotencyKey).toBe(`${executionId}:node_3`);

    // A node_skipped event was recorded for the resumed node.
    const events = await ctx.store.events.listByExecution(executionId);
    const skipped = events.filter((e) => e.event_type === 'node_skipped');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.node_id).toBe('node_1');

    // All three nodes are represented as succeeded in node_executions.
    const nodes = await ctx.store.nodeExecutions.listByExecution(executionId);
    const byNode = new Map(nodes.map((n) => [n.node_id, n.status]));
    expect(byNode.get('node_1')).toBe('succeeded');
    expect(byNode.get('node_2')).toBe('succeeded');
    expect(byNode.get('node_3')).toBe('succeeded');
  });

  it('a fresh execution (no crash) dispatches every node exactly once', async () => {
    const definition = crashRecoveryDefinition();
    const workflowId = 'wf-fresh';
    await ctx.store.workflows.create({
      id: workflowId,
      name: 'Fresh run',
      description: '',
      definition,
      created_by: 'system',
    });
    const executionId = 'exec-fresh-1';
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: workflowId,
      workflow_version: 1,
      trigger_type: 'manual',
    });

    await ctx.executor.execute(executionId, definition, {});

    const execution = await ctx.store.executions.getById(executionId);
    expect(execution?.status).toBe('succeeded');
    expect(ctx.mocks.recap.calls).toHaveLength(1);
    expect(ctx.mocks.vault.calls).toHaveLength(1);
    expect(ctx.mocks.desk.calls).toHaveLength(1);
  });
});
