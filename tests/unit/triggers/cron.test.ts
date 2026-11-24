import { describe, it, expect, vi } from 'vitest';
import { CronTriggerHandler } from '../../../packages/triggers/src/cron';

describe('CronTriggerHandler', () => {
  it('accepts valid cron expression', () => {
    const mockStore = {} as any;
    const cronHandler = new CronTriggerHandler(mockStore);

    expect(() => {
      cronHandler.register('trigger-1', 'workflow-1', { expression: '* * * * *' });
    }).not.toThrow();
  });

  it('throws on invalid cron expression', () => {
    const mockStore = {} as any;
    const cronHandler = new CronTriggerHandler(mockStore);

    expect(() => {
      cronHandler.register('trigger-1', 'workflow-1', { expression: 'invalid cron' });
    }).toThrow('Invalid cron expression: invalid cron');
  });

  it('registers and unregisters trigger lifecycle', () => {
    const mockStore = {} as any;
    const cronHandler = new CronTriggerHandler(mockStore);

    cronHandler.register('trigger-1', 'workflow-1', { expression: '* * * * *' });
    expect((cronHandler as any).jobs.size).toBe(1);

    cronHandler.unregister('trigger-1');
    expect((cronHandler as any).jobs.size).toBe(0);
  });

  it('shutdown stops all jobs', () => {
    const mockStore = {} as any;
    const cronHandler = new CronTriggerHandler(mockStore);

    cronHandler.register('trigger-1', 'workflow-1', { expression: '* * * * *' });
    cronHandler.register('trigger-2', 'workflow-2', { expression: '0 * * * *' });

    expect((cronHandler as any).jobs.size).toBe(2);

    cronHandler.shutdown();
    expect((cronHandler as any).jobs.size).toBe(0);
  });
});

describe('CronTriggerHandler — schedule preservation and tick failures (audit #62, #63)', () => {
  it('a rejected re-registration keeps the old schedule firing', async () => {
    const created: string[] = [];
    const mockStore = {
      workflows: { getById: vi.fn().mockResolvedValue({ id: 'workflow-1', version: 1, status: 'active' }) },
      executions: { create: vi.fn().mockImplementation(async ({ id }: { id: string }) => { created.push(id); }) },
    } as unknown as ConstructorParameters<typeof CronTriggerHandler>[0];
    const handler = new CronTriggerHandler(mockStore);
    try {
      handler.register('t-1', 'workflow-1', { expression: '* * * * * *' }); // every second
      expect(() => handler.register('t-1', 'workflow-1', { expression: 'not a cron' })).toThrow();
      await new Promise((r) => setTimeout(r, 1200));
      expect(created.length).toBeGreaterThan(0); // old schedule survived
    } finally {
      handler.shutdown();
    }
  });

  it('a tick that cannot create the execution is logged, not silently lost', async () => {
    const create = vi.fn().mockRejectedValue(new Error('database is locked'));
    const mockStore = {
      workflows: { getById: vi.fn().mockResolvedValue({ id: 'workflow-1', version: 1, status: 'active' }) },
      executions: { create },
    } as unknown as ConstructorParameters<typeof CronTriggerHandler>[0];
    const handler = new CronTriggerHandler(mockStore);
    try {
      handler.register('t-2', 'workflow-1', { expression: '* * * * * *' });
      await new Promise((r) => setTimeout(r, 1200));
      expect(create).toHaveBeenCalled();
      // The rejection was handled inside the tick (no unhandled rejection,
      // which vitest would surface as a test failure).
    } finally {
      handler.shutdown();
    }
  });
});
