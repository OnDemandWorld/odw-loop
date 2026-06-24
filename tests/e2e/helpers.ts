/**
 * Shared helpers for E2E tests.
 *
 * The production `buildApp()` wires everything together but doesn't expose the
 * services. For realistic end-to-end scenarios — where workflows must actually
 * execute against mock connectors — we build the services directly so the test
 * has full control over the mocks and can invoke the executor.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSqliteConnection, SqliteStateStore } from '../../packages/state/src';
import type { StateStore } from '../../packages/state/src';
import {
  ConnectorRegistry,
  type ConnectorAdapter,
  type ExecuteParams,
  type ExecuteResult,
} from '../../packages/connectors/src';
import type { ConnectorCapabilities } from '../../packages/types';
import { ExecutionExecutor } from '../../packages/engine/src/executor';
import { ExecutionRecovery } from '../../packages/engine/src/recovery';
import { EgressEngine } from '../../packages/egress/src/engine';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '../../packages/types';

// ─── Mock connector adapter ──────────────────────────────────────────────────

export interface MockAdapter extends ConnectorAdapter {
  readonly type: string;
  calls: ExecuteParams[];
  response: Record<string, unknown>;
  setError(err: Error): void;
  clearError(): void;
  reset(): void;
}

export function createMockAdapter(type: string, defaultResponse: Record<string, unknown> = {}): MockAdapter {
  let response = defaultResponse;
  let error: Error | null = null;
  const calls: ExecuteParams[] = [];

  const adapter: MockAdapter = {
    type,
    calls,
    get response() {
      return response;
    },
    set response(r) {
      response = r;
    },
    setError(err: Error) {
      error = err;
    },
    clearError() {
      error = null;
    },
    reset() {
      calls.length = 0;
      error = null;
    },
    async execute(params: ExecuteParams): Promise<ExecuteResult> {
      calls.push(params);
      if (error) throw error;
      return { output: { ...response } };
    },
    async healthCheck() {
      return error === null;
    },
    getCapabilities(): ConnectorCapabilities {
      return {
        node_types: [`${type}.op`],
        input_types: ['any'],
        output_types: ['any'],
      };
    },
  };

  return adapter;
}

// ─── Test context ────────────────────────────────────────────────────────────

export interface TestContext {
  dataDir: string;
  store: StateStore;
  connectors: ConnectorRegistry;
  executor: ExecutionExecutor;
  recovery: ExecutionRecovery;
  egressEngine: EgressEngine;
  mocks: {
    vault: MockAdapter;
    desk: MockAdapter;
    recap: MockAdapter;
    generic: MockAdapter;
  };
  close(): Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'loop-e2e-'));

  const conn = createSqliteConnection({ path: ':memory:', wal: false });
  const store = new SqliteStateStore(conn);
  await store.initialise();

  // Seed a "system" user that workflows reference via created_by / updated_by.
  // The workflows table has FK constraints to the users table.
  await store.users.create({
    id: 'system',
    username: 'system',
    password_hash: '',
    email: 'system@loop.internal',
    role: 'admin',
    display_name: 'System',
  });

  const vault = createMockAdapter('vault', { document_id: 'doc-1', stored: true });
  const desk = createMockAdapter('desk', { task_id: 'task-1', created: true });
  const recap = createMockAdapter('recap', {
    summary: 'Meeting summary',
    action_items: ['Follow up on budget'],
  });
  const generic = createMockAdapter('generic', { ok: true });

  const connectors = new ConnectorRegistry();
  connectors.registerAdapter(vault);
  connectors.registerAdapter(desk);
  connectors.registerAdapter(recap);
  connectors.registerAdapter(generic);

  const executor = new ExecutionExecutor(store, connectors, 5);
  const recovery = new ExecutionRecovery(store);
  const egressEngine = new EgressEngine(() => store.egressPolicies.listEnabled());

  return {
    dataDir,
    store,
    connectors,
    executor,
    recovery,
    egressEngine,
    mocks: { vault, desk, recap, generic },
    async close() {
      conn.close();
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

// ─── Factories ───────────────────────────────────────────────────────────────

export function createNode(id: string, type: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, config };
}

export function createEdge(source: string, target: string): WorkflowEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    source_port: 'output',
    target_port: 'input',
    type_compatibility: true,
  };
}

/** Meeting → Tasks → KB E2E scenario workflow definition. */
export function meetingToTasksDefinition(): WorkflowDefinition {
  return {
    version: '1.0',
    nodes: [
      createNode('node_1', 'recap.summarize', {
        transcript: '{{trigger.payload.transcript}}',
      }),
      createNode('node_2', 'desk.create_task', {
        title: 'Follow up',
      }),
      createNode('node_3', 'vault.create_document', {
        title: 'Meeting summary',
        content: '{{node_1.output.summary}}',
      }),
    ],
    edges: [createEdge('node_1', 'node_2'), createEdge('node_1', 'node_3')],
    variables: {},
    metadata: { name: 'meeting-to-tasks', description: 'E2E scenario' },
  };
}

/** Poll execution until it leaves pending/running, up to a timeout. */
export async function waitForExecution(
  store: StateStore,
  executionId: string,
  timeoutMs = 5000,
): Promise<{ status: string; error?: string | null }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const execution = await store.executions.getById(executionId);
    if (!execution) throw new Error(`Execution ${executionId} not found`);
    if (execution.status !== 'pending' && execution.status !== 'running') {
      return { status: execution.status, error: execution.error ?? null };
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Timed out waiting for execution ${executionId}`);
}
