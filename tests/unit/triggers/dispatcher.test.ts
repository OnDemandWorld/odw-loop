import { describe, it, expect, vi } from 'vitest';
import { TriggerDispatcher } from '../../../packages/triggers/src/dispatcher';

describe('TriggerDispatcher', () => {
  it('creates execution when event matches registered trigger', async () => {
    const mockStore = {
      triggers: {
        listEnabled: vi.fn().mockResolvedValue([
          {
            id: 'trigger-1',
            trigger_type: 'event',
            workflow_id: 'workflow-1',
            config: { source: 'odw', event_type: 'test.event' },
          },
        ]),
      },
      executions: {
        create: vi.fn().mockResolvedValue({}),
      },
    } as any;

    const dispatcher = new TriggerDispatcher(mockStore);
    const event = { source: 'odw', event_type: 'test.event', payload: { data: 'test' } };
    const executionIds = await dispatcher.dispatch(event);

    expect(executionIds).toHaveLength(1);
    expect(mockStore.executions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: 'workflow-1',
        trigger_type: 'event',
        trigger_payload: { data: 'test' },
      })
    );
  });

  it('does not create execution when event does not match any trigger', async () => {
    const mockStore = {
      triggers: {
        listEnabled: vi.fn().mockResolvedValue([
          {
            id: 'trigger-1',
            trigger_type: 'event',
            workflow_id: 'workflow-1',
            config: { source: 'odw', event_type: 'other.event' },
          },
        ]),
      },
      executions: {
        create: vi.fn().mockResolvedValue({}),
      },
    } as any;

    const dispatcher = new TriggerDispatcher(mockStore);
    const event = { source: 'odw', event_type: 'test.event', payload: { data: 'test' } };
    const executionIds = await dispatcher.dispatch(event);

    expect(executionIds).toHaveLength(0);
    expect(mockStore.executions.create).not.toHaveBeenCalled();
  });

  it('creates multiple executions when multiple triggers match same event', async () => {
    const mockStore = {
      triggers: {
        listEnabled: vi.fn().mockResolvedValue([
          {
            id: 'trigger-1',
            trigger_type: 'event',
            workflow_id: 'workflow-1',
            config: { source: 'odw', event_type: 'test.event' },
          },
          {
            id: 'trigger-2',
            trigger_type: 'event',
            workflow_id: 'workflow-2',
            config: { source: 'odw', event_type: 'test.event' },
          },
        ]),
      },
      executions: {
        create: vi.fn().mockResolvedValue({}),
      },
    } as any;

    const dispatcher = new TriggerDispatcher(mockStore);
    const event = { source: 'odw', event_type: 'test.event', payload: { data: 'test' } };
    const executionIds = await dispatcher.dispatch(event);

    expect(executionIds).toHaveLength(2);
    expect(mockStore.executions.create).toHaveBeenCalledTimes(2);
  });

  it('audit #86: only ENABLED triggers fire (real store), and the workflow version is snapshotted', async () => {
    const { createSqliteConnection, SqliteStateStore } = await import('../../../packages/state/src');
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    try {
      const store = new SqliteStateStore(conn);
      await store.initialise();
      await store.users.create({ id: 'system', username: 'system', password_hash: '', email: 's@loop.test', role: 'admin' });
      const workflowId = crypto.randomUUID();
      const def = { version: '1.0', nodes: [], edges: [], variables: {}, metadata: { name: 'disp' } };
      await store.workflows.create({ id: workflowId, name: 'disp', description: '', definition: def as never, created_by: 'system' });
      // Bump to version 3 so the snapshot assertion is meaningful.
      await store.workflows.update(workflowId, { definition: def as never, updated_by: 'system' });
      await store.workflows.update(workflowId, { definition: def as never, updated_by: 'system' });

      await store.triggers.create({ id: 't-enabled', workflow_id: workflowId, trigger_type: 'event', config: { source: 'odw', event_type: 'test.event' } });
      await store.triggers.create({ id: 't-disabled', workflow_id: workflowId, trigger_type: 'event', config: { source: 'odw', event_type: 'test.event' } });
      await store.triggers.update('t-disabled', { enabled: false });

      const dispatcher = new TriggerDispatcher(store);
      const ids = await dispatcher.dispatch({ source: 'odw', event_type: 'test.event', payload: { data: 'test' } });

      expect(ids).toHaveLength(1);
      const execs = await store.executions.list({ workflow_id: workflowId }, { page: 1, per_page: 10 });
      expect(execs.total).toBe(1);
      expect(execs.data[0]!.workflow_version).toBe(3);
    } finally {
      conn.close();
    }
  });
  it('audit #64: event triggers do not fire for archived workflows', async () => {
    const mockStore = {
      triggers: {
        listEnabled: vi.fn().mockResolvedValue([
          {
            id: 'trigger-archived',
            trigger_type: 'event',
            workflow_id: 'wf-archived',
            config: { source: 'odw', event_type: 'test.event' },
          },
        ]),
      },
      workflows: {
        getById: vi.fn().mockResolvedValue({ id: 'wf-archived', version: 3, status: 'archived' }),
      },
      executions: {
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as ConstructorParameters<typeof TriggerDispatcher>[0];

    const dispatcher = new TriggerDispatcher(mockStore);
    const event = { source: 'odw', event_type: 'test.event', payload: { data: 'test' } };
    const executionIds = await dispatcher.dispatch(event);

    expect(executionIds).toHaveLength(0);
    expect(mockStore.executions.create).not.toHaveBeenCalled();
  });
});
