/**
 * Regression tests for `executions.completeIfActive` (M3) and the
 * preserve-on-omit `updateStatus` semantics (M1).
 *
 * - completeIfActive applies terminal transitions only from pending/running,
 *   so an executor completion can never overwrite an API-initiated cancel and
 *   vice versa.
 * - updateStatus must not write NULL over stored fields it wasn't given —
 *   previously every terminal transition wiped started_at/duration_ms.
 */

import { describe, it, expect } from 'vitest';
import { createSqliteConnection, SqliteStateStore } from '../../../packages/state/src/index.js';

async function makeStore(): Promise<{ store: SqliteStateStore; close: () => void }> {
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
  return { store, close: () => conn.close() };
}

async function seedExecution(store: SqliteStateStore): Promise<string> {
  await store.workflows.create({
    id: 'wf-1',
    name: 'Test',
    description: '',
    definition: { version: '1.0', nodes: [], edges: [], variables: {}, metadata: { name: 'Test' } } as never,
    created_by: 'system',
  });
  const execution = await store.executions.create({
    id: 'exec-1',
    workflow_id: 'wf-1',
    workflow_version: 1,
    trigger_type: 'manual',
  });
  return execution.id;
}

describe('executions.completeIfActive', () => {
  it('applies a terminal transition while the execution is running', async () => {
    const { store, close } = await makeStore();
    try {
      const id = await seedExecution(store);
      await store.executions.updateStatus(id, { status: 'running', started_at: '2026-09-11T00:00:00.000Z' });

      const applied = await store.executions.completeIfActive(id, {
        status: 'succeeded',
        completed_at: '2026-09-11T00:01:00.000Z',
        duration_ms: 60_000,
      });
      expect(applied).toBe(true);

      const execution = await store.executions.getById(id);
      expect(execution?.status).toBe('succeeded');
      expect(execution?.started_at).toBe('2026-09-11T00:00:00.000Z');
    } finally {
      close();
    }
  });

  it('refuses to overwrite a terminal status (cancel vs completion race)', async () => {
    const { store, close } = await makeStore();
    try {
      const id = await seedExecution(store);
      await store.executions.updateStatus(id, { status: 'running', started_at: '2026-09-11T00:00:00.000Z' });

      // User cancels first…
      const cancelled = await store.executions.completeIfActive(id, {
        status: 'cancelled',
        completed_at: '2026-09-11T00:00:10.000Z',
      });
      expect(cancelled).toBe(true);

      // …the late executor completion must NOT flip cancelled → succeeded.
      const lateComplete = await store.executions.completeIfActive(id, {
        status: 'succeeded',
        completed_at: '2026-09-11T00:01:00.000Z',
      });
      expect(lateComplete).toBe(false);
      expect((await store.executions.getById(id))?.status).toBe('cancelled');
    } finally {
      close();
    }
  });

  it('a second cancel cannot flip a succeeded execution to cancelled', async () => {
    const { store, close } = await makeStore();
    try {
      const id = await seedExecution(store);
      await store.executions.updateStatus(id, { status: 'running', started_at: '2026-09-11T00:00:00.000Z' });
      await store.executions.completeIfActive(id, { status: 'succeeded' });

      const secondCancel = await store.executions.completeIfActive(id, { status: 'cancelled' });
      expect(secondCancel).toBe(false);
      expect((await store.executions.getById(id))?.status).toBe('succeeded');
    } finally {
      close();
    }
  });

  it('updateStatus preserves started_at on terminal transitions', async () => {
    const { store, close } = await makeStore();
    try {
      const id = await seedExecution(store);
      await store.executions.updateStatus(id, { status: 'running', started_at: '2026-09-11T00:00:00.000Z' });

      // No started_at passed → the stored value must survive (previously it
      // was overwritten with NULL, breaking ORDER BY started_at listings).
      await store.executions.updateStatus(id, {
        status: 'failed',
        completed_at: '2026-09-11T00:02:00.000Z',
        duration_ms: 120_000,
        error: 'boom',
      });
      const execution = await store.executions.getById(id);
      expect(execution?.started_at).toBe('2026-09-11T00:00:00.000Z');
      expect(execution?.error).toBe('boom');
    } finally {
      close();
    }
  });

  it('nodeExecutions.updateStatus preserves started_at when succeeding', async () => {
    const { store, close } = await makeStore();
    try {
      await seedExecution(store);
      await store.nodeExecutions.create({
        id: 'ne-1',
        execution_id: 'exec-1',
        node_id: 'node_a',
        node_type: 'generic.rest_call',
      });
      await store.nodeExecutions.updateStatus('ne-1', {
        status: 'running',
        started_at: '2026-09-11T00:00:05.000Z',
      });
      await store.nodeExecutions.updateStatus('ne-1', {
        status: 'succeeded',
        completed_at: '2026-09-11T00:00:06.000Z',
        output: { ok: true },
      });

      const node = await store.nodeExecutions.listByExecution('exec-1');
      expect(node[0]?.started_at).toBe('2026-09-11T00:00:05.000Z');
      expect(node[0]?.output).toEqual({ ok: true });
    } finally {
      close();
    }
  });

  it('workflows.delete cascades through execution_events without FK errors', async () => {
    const { store, close } = await makeStore();
    try {
      const id = await seedExecution(store);
      await store.executions.updateStatus(id, { status: 'running', started_at: '2026-09-11T00:00:00.000Z' });
      await store.nodeExecutions.create({
        id: 'ne-1',
        execution_id: 'exec-1',
        node_id: 'node_a',
        node_type: 'generic.rest_call',
      });
      await store.events.append({ id: 'evt-1', execution_id: 'exec-1', event_type: 'execution_started' });

      // Previously failed with a FOREIGN KEY constraint (execution_events was
      // never deleted) and orphaned node_executions (matched on the wrong id).
      await expect(store.workflows.delete('wf-1')).resolves.toBeUndefined();
      expect(await store.workflows.getById('wf-1')).toBeNull();
      expect(await store.executions.getById(id)).toBeNull();
      expect(await store.nodeExecutions.listByExecution(id)).toHaveLength(0);
      expect(await store.events.listByExecution(id)).toHaveLength(0);
    } finally {
      close();
    }
  });
});
