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

/** Runs the execution created by a cron tick (bug 14: records alone were never executed). */
export type CronDispatcher = (params: {
  executionId: string;
  workflowId: string;
  payload: Record<string, unknown>;
}) => Promise<void>;

export class CronTriggerHandler {
  private jobs = new Map<string, ScheduledJob>();

  constructor(
    private store: StateStore,
    private dispatcher?: CronDispatcher,
  ) {}

  /** Initialise — load all enabled cron triggers and register them. */
  async initialise(): Promise<void> {
    const triggers = await this.store.triggers.listEnabled();
    let loadErrors = 0;
    for (const trigger of triggers) {
      if (trigger.trigger_type !== 'cron') continue;
      try {
        this.register(trigger.id, trigger.workflow_id, trigger.config as { expression: string; timezone?: string });
      } catch (err) {
        // One polluted row (e.g. an invalid expression) must not take the
        // whole server down in a restart loop (M6) — skip and log it.
        loadErrors++;
        logger.error({ triggerId: trigger.id, error: String(err) }, 'Skipping invalid cron trigger');
      }
    }
    logger.info({ count: this.jobs.size, skipped: loadErrors }, 'Cron triggers registered');
  }

  /** Register a cron trigger. */
  register(triggerId: string, workflowId: string, config: { expression: string; timezone?: string }): void {
    // Audit #62: validate BEFORE touching the existing job — unregistering
    // first meant a rejected replacement left the workflow permanently
    // unscheduled (the PUT route rolls back the DB but not the scheduler).
    if (!cron.validate(config.expression)) {
      throw new Error(`Invalid cron expression: ${config.expression}`);
    }

    // Swap only once the replacement is known-valid.
    this.unregister(triggerId);

    const task = cron.schedule(config.expression, async () => {
      // Read the current workflow version at fire time (not registration time)
      // so that updated workflows execute their latest definition.
      let workflowVersion = 1;
      try {
        const workflow = await this.store.workflows.getById(workflowId);
        if (workflow) {
          // An archived workflow must not keep producing executions —
          // deletion only flips status, so the guard has to live at fire
          // time (registered schedules outlive the DELETE call).
          if (workflow.status === 'archived') {
            logger.warn({ triggerId, workflowId }, 'Cron trigger skipped: workflow is archived');
            return;
          }
          workflowVersion = workflow.version;
        }
      } catch {
        logger.warn({ workflowId }, 'Failed to read workflow version, defaulting to 1');
      }
      const executionId = randomUUID();
      const payload = { scheduled_at: new Date().toISOString() };
      // Audit #63: a tick that fails to create the execution must be logged —
      // node-cron swallows async rejections into a 'task-failed' event that
      // nobody listened to, losing scheduled runs without a trace.
      try {
        await this.store.executions.create({
          id: executionId,
          workflow_id: workflowId,
          workflow_version: workflowVersion,
          trigger_type: 'cron',
          trigger_payload: payload,
        });
      } catch (err) {
        logger.error({ triggerId, workflowId, executionId, error: String(err) }, 'Cron tick failed to create execution');
        return;
      }
      logger.info({ triggerId, executionId, workflowVersion }, 'Cron trigger fired');

      // Actually run the workflow — creating the record alone leaves it
      // pending forever (bug 14). Settle to failed if dispatch cannot start.
      if (this.dispatcher) {
        try {
          await this.dispatcher({ executionId, workflowId, payload });
        } catch (err) {
          await this.store.executions
            .updateStatus(executionId, {
              status: 'failed',
              error: `Cron dispatch failed: ${String(err)}`,
              completed_at: new Date().toISOString(),
            })
            .catch(() => {});
          logger.error({ triggerId, executionId, error: String(err) }, 'Cron dispatch failed');
        }
      }
    }, {
      timezone: config.timezone ?? 'UTC',
      scheduled: true,
    });

    // Audit #63: surface anything node-cron catches inside the task.
    task.on('task-failed', (err: unknown) => {
      logger.error({ triggerId, workflowId, error: String(err) }, 'Cron task failed');
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
