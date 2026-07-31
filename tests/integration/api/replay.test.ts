/**
 * Integration tests — replay API (V1.3 M1, F-Loop-1).
 *
 *  - GET  /api/v1/executions/:id/replay → reconstructed snapshot + dry-run
 *    decisions (read-only; connectors are NOT invoked).
 *  - POST /api/v1/executions/:id/replay?dryRun= → default dry-run; ?dryRun=false
 *    really re-executes via the resume path.
 *  - Unknown execution → 404.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { buildTestApp, type TestApp } from '../_helpers/app.js';
import type { ConnectorAdapter, ConnectorCapabilities } from '../../../packages/connectors/src';
import type { WorkflowDefinition } from '../../../packages/types/src';

function mockAdapter(type: string, fail = false): { adapter: ConnectorAdapter; counter: { calls: number } } {
  const counter = { calls: 0 };
  const adapter: ConnectorAdapter = {
    type,
    async execute() {
      counter.calls += 1;
      if (fail) throw new Error(`${type} exploded`);
      return { output: { ok: true } };
    },
    async healthCheck() {
      return true;
    },
    getCapabilities(): ConnectorCapabilities {
      return { node_types: [`${type}.op`], input_types: ['any'], output_types: ['any'] };
    },
  };
  return { adapter, counter };
}

function node(id: string, type: string) {
  return { id, type, position: { x: 0, y: 0 }, config: {} };
}

describe('API replay (V1.3 M1)', () => {
  const contexts: TestApp[] = [];

  afterAll(async () => {
    for (const ctx of contexts) {
      await ctx.app.close();
      ctx.conn.close();
    }
  });

  async function build(): Promise<TestApp> {
    const ctx = await buildTestApp();
    await ctx.app.ready();
    contexts.push(ctx);
    return ctx;
  }

  async function seedRun(
    ctx: TestApp,
    definition: WorkflowDefinition,
  ): Promise<string> {
    const workflowId = crypto.randomUUID();
    await ctx.store.workflows.create({
      id: workflowId,
      name: 'Replay API wf',
      description: '',
      definition,
      created_by: 'system',
    });
    const executionId = crypto.randomUUID();
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: workflowId,
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: {},
    });
    return executionId;
  }

  it('GET replay returns snapshot + dry-run decisions for a succeeded execution', async () => {
    const ctx = await build();
    const mock = mockAdapter('mock');
    ctx.connectors.registerAdapter(mock.adapter);

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('n1', 'mock.op'), node('n2', 'mock.op')],
      edges: [{ id: 'e', source: 'n1', target: 'n2' }],
      variables: {},
      metadata: { name: 'replay-ok' },
    };
    const executionId = await seedRun(ctx, definition);
    await ctx.executor.execute(executionId, definition, {});
    expect(mock.counter.calls).toBe(2);

    const res = await ctx.app.inject({ method: 'GET', url: `/api/v1/executions/${executionId}/replay` });
    expect(res.statusCode).toBe(200);

    const data = res.json().data;
    expect(data.dryRun).toBe(true);
    expect(data.snapshot.status).toBe('succeeded');
    // nodeStates is serialised to a plain record for JSON transport.
    expect(data.snapshot.nodeStates.n1.status).toBe('succeeded');
    expect(data.snapshot.nodeStates.n2.status).toBe('succeeded');
    expect(data.decisions).toHaveLength(2);
    expect(data.decisions.every((d: { decision: string }) => d.decision === 'skipped-because-succeeded')).toBe(true);

    // Dry-run did not invoke connectors again.
    expect(mock.counter.calls).toBe(2);
  });

  it('GET replay surfaces the failure point for a failed execution', async () => {
    const ctx = await build();
    ctx.connectors.registerAdapter(mockAdapter('good').adapter);
    ctx.connectors.registerAdapter(mockAdapter('bad', true).adapter);

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('n1', 'good.op'), node('n2', 'bad.op')],
      edges: [{ id: 'e', source: 'n1', target: 'n2' }],
      variables: {},
      metadata: { name: 'replay-fail' },
    };
    const executionId = await seedRun(ctx, definition);
    await expect(ctx.executor.execute(executionId, definition, {})).rejects.toThrow(/bad exploded/);

    const res = await ctx.app.inject({ method: 'GET', url: `/api/v1/executions/${executionId}/replay` });
    expect(res.statusCode).toBe(200);

    const data = res.json().data;
    expect(data.snapshot.status).toBe('failed');
    const byNode = new Map<string, string>(data.decisions.map((d: { nodeId: string; decision: string }) => [d.nodeId, d.decision]));
    expect(byNode.get('n1')).toBe('skipped-because-succeeded');
    expect(byNode.get('n2')).toBe('failed');
  });

  it('POST replay defaults to dry-run (no connector calls)', async () => {
    const ctx = await build();
    const mock = mockAdapter('mock');
    ctx.connectors.registerAdapter(mock.adapter);

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('n1', 'mock.op')],
      edges: [],
      variables: {},
      metadata: { name: 'replay-post' },
    };
    const executionId = await seedRun(ctx, definition);
    await ctx.executor.execute(executionId, definition, {});
    expect(mock.counter.calls).toBe(1);

    const res = await ctx.app.inject({ method: 'POST', url: `/api/v1/executions/${executionId}/replay` });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.dryRun).toBe(true);
    expect(data.rerun).toBeUndefined();
    expect(mock.counter.calls).toBe(1); // unchanged
  });

  it('POST replay?dryRun=false re-executes via the resume path', async () => {
    const ctx = await build();
    const mock = mockAdapter('mock');
    ctx.connectors.registerAdapter(mock.adapter);

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [node('n1', 'mock.op'), node('n2', 'mock.op')],
      edges: [{ id: 'e', source: 'n1', target: 'n2' }],
      variables: {},
      metadata: { name: 'replay-rerun' },
    };
    const executionId = await seedRun(ctx, definition);
    await ctx.executor.execute(executionId, definition, {});
    expect(mock.counter.calls).toBe(2);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/executions/${executionId}/replay?dryRun=false`,
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.dryRun).toBe(false);
    expect(data.rerun.status).toBe('succeeded');
    // Both nodes already succeeded → resume skips them (no new dispatch).
    expect(mock.counter.calls).toBe(2);
  });

  it('GET replay for an unknown execution → 404', async () => {
    const ctx = await build();
    const res = await ctx.app.inject({ method: 'GET', url: `/api/v1/executions/${crypto.randomUUID()}/replay` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND_EXECUTION');
  });
});
