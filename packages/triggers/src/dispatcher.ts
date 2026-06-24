/**
 * Trigger dispatcher — matches incoming events to registered triggers and
 * creates workflow executions (§6.1 steps 1–3).
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@loop/observability';
import { metricsRegistry } from '@loop/observability';
import type { StateStore } from '@loop/state';

const logger = createLogger({ name: 'loop:triggers:dispatcher', component: 'triggers' });
const metrics = metricsRegistry();

export interface TriggerEvent {
  source: string;
  event_type: string;
  payload: Record<string, unknown>;
}

export class TriggerDispatcher {
  constructor(private store: StateStore) {}

  /** Match an event against all enabled triggers and create executions. */
  async dispatch(event: TriggerEvent): Promise<string[]> {
    const triggers = await this.store.triggers.listEnabled();
    const executionIds: string[] = [];

    for (const trigger of triggers) {
      const config = trigger.config as Record<string, unknown>;

      let matches = false;
      switch (trigger.trigger_type) {
        case 'event':
          matches = config['source'] === event.source && config['event_type'] === event.event_type;
          break;
        case 'webhook':
        case 'cron':
        case 'manual':
          // These are triggered through dedicated handlers, not event matching
          break;
      }

      if (matches) {
        const executionId = randomUUID();
        await this.store.executions.create({
          id: executionId,
          workflow_id: trigger.workflow_id,
          workflow_version: 1, // Will be resolved from current workflow version
          trigger_type: 'event',
          trigger_payload: event.payload,
        });
        executionIds.push(executionId);
        metrics.triggerFiresTotal.inc({ trigger_type: trigger.trigger_type, workflow_id: trigger.workflow_id });
        logger.info({ triggerId: trigger.id, executionId }, 'Trigger matched — execution created');
      }
    }

    return executionIds;
  }
}
