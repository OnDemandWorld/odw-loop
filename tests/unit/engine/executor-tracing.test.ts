/**
 * V1.6 M1 (F-2, SP3): executor span tree.
 *
 * A successful run emits one `loop.execution` root span parenting one
 * `loop.node` span per dispatched node; a failing run marks the execution and
 * failing node spans `error`; with sampling off the executor emits no spans
 * and behaves identically. Tracing never changes execution results.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import type { SqliteStateStore } from '../../../packages/state/src/index.js';
import { ConnectorRegistry, type ConnectorAdapter } from '../../../packages/connectors/src/index.js';
import { ExecutionExecutor } from '../../../packages/engine/src/executor.js';
import { EventBus } from '../../../packages/engine/src/eventBus.js';
import {
  configureTracing,
  resetTracing,
  type SpanData,
  type SpanExporter,
} from '../../../packages/observability/src/index.js';
import type { WorkflowDefinition, ConnectorCapabilities } from '../../../packages/types/src/index.js';
import { withSeededTestStore } from '../../helpers/testStore.js';

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

async function seedExecution(store: SqliteStateStore, definition: WorkflowDefinition): Promise<string> {
  const workflowId = `wf-${crypto.randomUUID()}`;
  await store.workflows.create({
    id: workflowId,
    name: 'Tracing executor test',
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

/** Two-node chain: node_a → node_b. */
const CHAIN_DEFINITION: WorkflowDefinition = {
  version: '1.0',
  nodes: [node('node_a', 'mock.op'), node('node_b', 'mock.op')],
  edges: [{ id: 'a->b', source: 'node_a', target: 'node_b' }],
  variables: {},
  metadata: { name: 'tracing-chain' },
};

describe('ExecutionExecutor — span tree (V1.6 F-2)', () => {
  let spans: SpanData[];
  const exporter: SpanExporter = {
    export(span: SpanData): void {
      spans.push(span);
    },
  };

  beforeEach(() => {
    spans = [];
    resetTracing();
    configureTracing({ exporter, sampleRate: 1 });
  });

  afterEach(() => {
    resetTracing();
  });

  it('emits an execution span parenting one span per node', async () => {
    await withSeededTestStore(async ({ store }) => {
      const connectors = new ConnectorRegistry();
      connectors.registerAdapter(okAdapter('mock'));
      const executor = new ExecutionExecutor(store, connectors, 5, 2000, 10_000, new EventBus());

      const executionId = await seedExecution(store, CHAIN_DEFINITION);
      await executor.execute(executionId, CHAIN_DEFINITION, {});

      const executionSpans = spans.filter((s) => s.name === 'loop.execution');
      const nodeSpans = spans.filter((s) => s.name === 'loop.node');
      expect(executionSpans).toHaveLength(1);
      expect(nodeSpans).toHaveLength(2);

      const executionSpan = executionSpans[0]!;
      expect(executionSpan.parent_span_id).toBeUndefined();
      expect(executionSpan.status).toBe('ok');
      expect(executionSpan.attrs?.['execution.id']).toBe(executionId);
      expect(executionSpan.attrs?.['workflow.id']).toBe('tracing-chain');
      expect(executionSpan.duration_ms).toBeGreaterThanOrEqual(0);

      // Every node span is a child of the execution span, same trace.
      for (const ns of nodeSpans) {
        expect(ns.parent_span_id).toBe(executionSpan.span_id);
        expect(ns.trace_id).toBe(executionSpan.trace_id);
        expect(ns.status).toBe('ok');
      }
      const nodeIds = nodeSpans.map((s) => s.attrs?.['node.id']).sort();
      expect(nodeIds).toEqual(['node_a', 'node_b']);
      for (const ns of nodeSpans) {
        expect(ns.attrs?.['node.type']).toBe('mock.op');
      }
    });
  });

  it('marks the execution and failing node spans error without changing the outcome', async () => {
    await withSeededTestStore(async ({ store }) => {
      const connectors = new ConnectorRegistry();
      connectors.registerAdapter(failingAdapter('bad'));
      const executor = new ExecutionExecutor(store, connectors, 5, 2000, 10_000, new EventBus());

      const definition: WorkflowDefinition = {
        version: '1.0',
        nodes: [node('node_x', 'bad.op')],
        edges: [],
        variables: {},
        metadata: { name: 'tracing-failure' },
      };
      const executionId = await seedExecution(store, definition);

      // Execution still fails exactly as before tracing existed.
      await expect(executor.execute(executionId, definition, {})).rejects.toThrow('adapter exploded');

      const executionSpan = spans.find((s) => s.name === 'loop.execution');
      const nodeSpan = spans.find((s) => s.name === 'loop.node');
      expect(executionSpan?.status).toBe('error');
      expect(executionSpan?.attrs?.['error.message']).toContain('adapter exploded');
      expect(nodeSpan?.status).toBe('error');
      expect(nodeSpan?.parent_span_id).toBe(executionSpan?.span_id);
    });
  });

  it('sampling off — no spans emitted, execution result unchanged', async () => {
    configureTracing({ exporter, sampleRate: 0 });

    await withSeededTestStore(async ({ store }) => {
      const connectors = new ConnectorRegistry();
      connectors.registerAdapter(okAdapter('mock'));
      const executor = new ExecutionExecutor(store, connectors, 5, 2000, 10_000, new EventBus());

      const executionId = await seedExecution(store, CHAIN_DEFINITION);
      await executor.execute(executionId, CHAIN_DEFINITION, {});

      const execution = await store.executions.getById(executionId);
      expect(execution?.status).toBe('succeeded');
      expect(spans).toHaveLength(0);
    });
  });
});
