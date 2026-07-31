/**
 * Unit tests — ExecutionRecovery event recording (V1.1 M1, F1).
 *
 * Resetting an interrupted execution to 'pending' must append an
 * execution_recovered event; a non-recoverable execution (no succeeded nodes)
 * is marked failed and records no recovery event.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  createSqliteConnection,
  SqliteStateStore,
  type SqliteConnection,
} from '../../../packages/state/src';
import { ExecutionRecovery } from '../../../packages/engine/src/recovery';
import type { WorkflowDefinition } from '../../../packages/types/src';

const DEFINITION: WorkflowDefinition = {
  version: '1.0',
  nodes: [],
  edges: [],
  variables: {},
  metadata: { name: 'recovery-test' },
};

async function createStore(): Promise<{ conn: SqliteConnection; store: SqliteStateStore }> {
  const conn = createSqliteConnection({ path: ':memory:', wal: false });
  const store = new SqliteStateStore(conn);
  await store.initialise();
  await store.users.create({
    id: 'system',
    username: 'system',
    password_hash: '',
    email: 'system@loop.internal',
    role: 'admin',
  });
  return { conn, store };
}

async function seedRunningExecution(store: SqliteStateStore): Promise<string> {
  const workflowId = crypto.randomUUID();
  await store.workflows.create({
    id: workflowId,
    name: 'Recovery test',
    description: '',
    definition: DEFINITION,
    created_by: 'system',
  });
  const executionId = crypto.randomUUID();
  await store.executions.create({
    id: executionId,
    workflow_id: workflowId,
    workflow_version: 1,
    trigger_type: 'manual',
  });
  await store.executions.updateStatus(executionId, {
    status: 'running',
    started_at: new Date().toISOString(),
  });
  return executionId;
}

describe('ExecutionRecovery — event recording (V1.1 M1)', () => {
  const conns: SqliteConnection[] = [];
  afterEach(() => {
    while (conns.length > 0) conns.pop()!.close();
  });

  it('appends execution_recovered when resetting a resumable execution', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);
    const executionId = await seedRunningExecution(store);

    // A succeeded node makes the execution resumable.
    const neId = crypto.randomUUID();
    await store.nodeExecutions.create({
      id: neId,
      execution_id: executionId,
      node_id: 'node_a',
      node_type: 'vault.search',
    });
    await store.nodeExecutions.updateStatus(neId, {
      status: 'succeeded',
      output: { ok: true },
      completed_at: new Date().toISOString(),
    });

    const recovery = new ExecutionRecovery(store);
    const result = await recovery.recover();
    expect(result.recovered).toBe(1);

    const execution = await store.executions.getById(executionId);
    expect(execution?.status).toBe('pending');

    const events = await store.events.listByExecution(executionId);
    const recovered = events.find((e) => e.event_type === 'execution_recovered');
    expect(recovered).toBeDefined();
    expect(recovered!.payload).toMatchObject({ last_succeeded_node: 'node_a' });
  });

  it('marks a non-recoverable execution failed without a recovery event', async () => {
    const { conn, store } = await createStore();
    conns.push(conn);
    const executionId = await seedRunningExecution(store);
    // No succeeded nodes → not resumable.

    const recovery = new ExecutionRecovery(store);
    const result = await recovery.recover();
    expect(result.failed).toBe(1);

    const execution = await store.executions.getById(executionId);
    expect(execution?.status).toBe('failed');

    const events = await store.events.listByExecution(executionId);
    expect(events.find((e) => e.event_type === 'execution_recovered')).toBeUndefined();
  });
});
