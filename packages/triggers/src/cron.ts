/**
 * Cron trigger handler — schedules periodic workflow executions (§8.1).
 */

import cron from 'node-cron';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@loop/observability';
import type { StateStore } from '@loop/state';

const logger = createLogger({ name: 'loop:triggers:cron', component: 'triggers' });

interface ScheduledJob {
  triggerId: string;
  task: cron.ScheduledTask;
}

export class CronTriggerHandler {
  private jobs = new Map<string, ScheduledJob>();

  constructor(private store: StateStore) {}

  /** Initialise — load all enabled cron triggers and register them. */
  async initialise(): Promise<void> {
    const triggers = await this.store.triggers.listEnabled();
    for (const trigger of triggers) {
      if (trigger.trigger_type !== 'cron') continue;
      this.register(trigger.id, trigger.workflow_id, trigger.config as { expression: string; timezone?: string });
    }
    logger.info({ count: this.jobs.size }, 'Cron triggers registered');
  }

  /** Register a cron trigger. */
  register(triggerId: string, workflowId: string, config: { expression: string; timezone?: string }): void {
    // Unregister if already exists
    this.unregister(triggerId);

    if (!cron.validate(config.expression)) {
      throw new Error(`Invalid cron expression: ${config.expression}`);
    }

    const task = cron.schedule(config.expression, async () => {
      const executionId = randomUUID();
      await this.store.executions.create({
        id: executionId,
        workflow_id: workflowId,
        workflow_version: 1,
        trigger_type: 'cron',
        trigger_payload: { scheduled_at: new Date().toISOString() },
      });
      logger.info({ triggerId, executionId }, 'Cron trigger fired');
    }, {
      timezone: config.timezone ?? 'UTC',
      scheduled: true,
    });

    this.jobs.set(triggerId, { triggerId, task });
  }

  /** Unregister a cron trigger. */
  unregister(triggerId: string): void {
    const job = this.jobs.get(triggerId);
    if (job) {
      job.task.stop();
      this.jobs.delete(triggerId);
    }
  }

  /** Stop all scheduled jobs. */
  shutdown(): void {
    for (const job of this.jobs.values()) {
      job.task.stop();
    }
    this.jobs.clear();
  }
}
