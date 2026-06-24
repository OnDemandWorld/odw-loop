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

  it('skips disabled triggers', async () => {
    const mockStore = {
      triggers: {
        listEnabled: vi.fn().mockResolvedValue([]), // listEnabled returns only enabled
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
});
