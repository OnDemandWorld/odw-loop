/**
 * E2E — Execution recovery after node failure (Scale-tier simulation).
 *
 * Simulates the failure scenario:
 *   1. Start a workflow execution.
 *   2. Some nodes succeed; then the process "crashes" (simulated by leaving
 *      the execution in `running` status with partial node outputs).
 *   3. Build a fresh app (simulating restart).
 *   4. Verify that ExecutionRecovery.recover() processes the interrupted execution:
 *      - If no nodes had succeeded: marks as `failed` (non-recoverable).
 *      - If at least one node had succeeded: resets the execution to `pending`
 *        (a re-runnable state) so the scheduler re-queues it from the last
 *        successful node on the next execution cycle.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';


import { buildTestApp, seedWorkflow } from '../integration/_helpers/app.js';

import {
  createTestContext,
  createNode,
  createEdge,
  type TestContext,
} from './helpers';

describe('Failover / execution recovery (E2E)', () => {
  let ctx: TestContext;

  afterEach(async () => {
    if (ctx) await ctx.close();
  });

  it('marks execution as failed on restart when no nodes had completed', async () => {
    ctx = await createTestContext();

    // Simulate a workflow that started but crashed before any node completed
    await ctx.store.workflows.create({
      id: 'wf-failover-1',
      name: 'Failover test 1',
      description: '',
      definition: {
        version: '1.0',
        nodes: [createNode('node_1', 'vault.create_document'), createNode('node_2', 'desk.create_task')],
        edges: [createEdge('node_1', 'node_2')],
        variables: {},
        metadata: { name: 'failover-1' },
      },
      created_by: 'system',
    });

    // Simulate partial execution: execution is 'running', one node was created
    // but never completed (status 'pending').
    const executionId = 'exec-crash-1';
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: 'wf-failover-1',
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: {},
    });
    await ctx.store.executions.updateStatus(executionId, {
      status: 'running',
      started_at: new Date().toISOString(),
    });
    await ctx.store.nodeExecutions.create({
      id: 'node-exec-1',
      execution_id: executionId,
      node_id: 'node_1',
      node_type: 'vault.create_document',
    });
    // Node is still pending (never transitioned to succeeded)

    // Simulate restart — run recovery
    const result = await ctx.recovery.recover();
    expect(result.failed).toBe(1);
    expect(result.recovered).toBe(0);

    // The execution should now be marked as failed
    const final = await ctx.store.executions.getById(executionId);
    expect(final?.status).toBe('failed');
    expect(final?.error).toMatch(/Interrupted by system restart/);
  });

  it('re-queues recoverable execution (reset to pending) on restart when nodes had succeeded', async () => {
    ctx = await createTestContext();

    await ctx.store.workflows.create({
      id: 'wf-failover-2',
      name: 'Failover test 2',
      description: '',
      definition: {
        version: '1.0',
        nodes: [
          createNode('node_1', 'vault.create_document'),
          createNode('node_2', 'desk.create_task'),
          createNode('node_3', 'recap.summarize'),
        ],
        edges: [createEdge('node_1', 'node_2'), createEdge('node_2', 'node_3')],
        variables: {},
        metadata: { name: 'failover-2' },
      },
      created_by: 'system',
    });

    // Simulate a workflow that crashed after node_1 succeeded
    const executionId = 'exec-crash-2';
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: 'wf-failover-2',
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: {},
    });
    await ctx.store.executions.updateStatus(executionId, {
      status: 'running',
      started_at: new Date().toISOString(),
    });

    // Node 1 succeeded
    await ctx.store.nodeExecutions.create({
      id: 'node-exec-2a',
      execution_id: executionId,
      node_id: 'node_1',
      node_type: 'vault.create_document',
    });
    await ctx.store.nodeExecutions.updateStatus('node-exec-2a', {
      status: 'succeeded',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      output: { document_id: 'doc-1' },
    });

    // Node 2 was started but not finished
    await ctx.store.nodeExecutions.create({
      id: 'node-exec-2b',
      execution_id: executionId,
      node_id: 'node_2',
      node_type: 'desk.create_task',
    });
    await ctx.store.nodeExecutions.updateStatus('node-exec-2b', {
      status: 'running',
      started_at: new Date().toISOString(),
    });

    // Node 3 was never started
    await ctx.store.nodeExecutions.create({
      id: 'node-exec-2c',
      execution_id: executionId,
      node_id: 'node_3',
      node_type: 'recap.summarize',
    });

    const result = await ctx.recovery.recover();
    expect(result.recovered).toBe(1);
    expect(result.failed).toBe(0);

    // Corrected behaviour: a recoverable execution (at least one node had
    // succeeded) is reset to 'pending' — a re-runnable state — so the scheduler
    // re-queues it from the last successful node on the next execution cycle.
    const final = await ctx.store.executions.getById(executionId);
    expect(final?.status).toBe('pending');
  });

  it('handles multiple interrupted executions in one recovery pass', async () => {
    ctx = await createTestContext();

    // Execution A: no nodes completed → failed
    await ctx.store.workflows.create({
      id: 'wf-multi-a',
      name: 'Multi A',
      description: '',
      definition: {
        version: '1.0',
        nodes: [createNode('node_1', 'vault.create_document')],
        edges: [],
        variables: {},
        metadata: { name: 'multi-a' },
      },
      created_by: 'system',
    });
    await ctx.store.executions.create({
      id: 'exec-multi-a',
      workflow_id: 'wf-multi-a',
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: {},
    });
    await ctx.store.executions.updateStatus('exec-multi-a', {
      status: 'running',
      started_at: new Date().toISOString(),
    });

    // Execution B: node succeeded → recoverable
    await ctx.store.workflows.create({
      id: 'wf-multi-b',
      name: 'Multi B',
      description: '',
      definition: {
        version: '1.0',
        nodes: [createNode('node_1', 'vault.create_document'), createNode('node_2', 'desk.create_task')],
        edges: [createEdge('node_1', 'node_2')],
        variables: {},
        metadata: { name: 'multi-b' },
      },
      created_by: 'system',
    });
    await ctx.store.executions.create({
      id: 'exec-multi-b',
      workflow_id: 'wf-multi-b',
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: {},
    });
    await ctx.store.executions.updateStatus('exec-multi-b', {
      status: 'running',
      started_at: new Date().toISOString(),
    });
    await ctx.store.nodeExecutions.create({
      id: 'node-exec-b1',
      execution_id: 'exec-multi-b',
      node_id: 'node_1',
      node_type: 'vault.create_document',
    });
    await ctx.store.nodeExecutions.updateStatus('node-exec-b1', {
      status: 'succeeded',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      output: { document_id: 'doc-b' },
    });

    const result = await ctx.recovery.recover();
    expect(result.failed).toBe(1);
    expect(result.recovered).toBe(1);

    const finalA = await ctx.store.executions.getById('exec-multi-a');
    expect(finalA?.status).toBe('failed');

    // Execution B had a succeeded node → recoverable → reset to 'pending'.
    const finalB = await ctx.store.executions.getById('exec-multi-b');
    expect(finalB?.status).toBe('pending');
  });

  it('recovery is idempotent: running it twice has no additional effect', async () => {
    ctx = await createTestContext();

    await ctx.store.workflows.create({
      id: 'wf-idempotent',
      name: 'Idempotent',
      description: '',
      definition: {
        version: '1.0',
        nodes: [createNode('node_1', 'vault.create_document')],
        edges: [],
        variables: {},
        metadata: { name: 'idempotent' },
      },
      created_by: 'system',
    });

    await ctx.store.executions.create({
      id: 'exec-idempotent',
      workflow_id: 'wf-idempotent',
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: {},
    });
    await ctx.store.executions.updateStatus('exec-idempotent', {
      status: 'running',
      started_at: new Date().toISOString(),
    });

    const first = await ctx.recovery.recover();
    expect(first.failed).toBe(1);

    // Second run: no more interrupted executions
    const second = await ctx.recovery.recover();
    expect(second.failed).toBe(0);
    expect(second.recovered).toBe(0);
  });

  it('audit #73: new app startup runs recovery automatically (real startup chain)', async () => {
    // File-backed SQLite shared between two app builds: the second build's
    // STARTUP recovery must re-dispatch the interrupted execution without any
    // manual executor invocation (production chain: recover -> dispatch ->
    // execute). buildTestApp mirrors server.ts wiring incl. startup recovery.
    const dbPath = path.join(os.tmpdir(), `loop-failover-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    const first = await buildTestApp({ LOOP_DB_PATH: dbPath });
    try {
      const wf = await seedWorkflow(first.store, { name: 'Auto recover' });
      await first.store.executions.create({
        id: 'exec-auto-recover',
        workflow_id: wf.id,
        workflow_version: 1,
        trigger_type: 'manual',
        trigger_payload: {},
      });
      // 'pending' = created but never dispatched (crash before pickup).
    } finally {
      await first.app.close();
      first.conn.close();
    }

    const second = await buildTestApp({ LOOP_DB_PATH: dbPath });
    try {
      await second.app.ready();
      // Startup recovery re-dispatches; the empty definition settles fast.
      const start = Date.now();
      let status = 'pending';
      while (Date.now() - start < 3000) {
        const ex = await second.store.executions.getById('exec-auto-recover');
        status = ex?.status ?? 'pending';
        if (status !== 'pending' && status !== 'running') break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(status).toBe('succeeded');
      const events = await second.store.events.listByExecution('exec-auto-recover');
      expect(events.some((e) => e.event_type === 'execution_recovered')).toBe(true);
    } finally {
      await second.app.close();
      second.conn.close();
      fs.rmSync(dbPath, { force: true });
    }
  });
});
