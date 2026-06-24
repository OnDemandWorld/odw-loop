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
