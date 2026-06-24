/**
 * Manual trigger handler — creates an execution from an API call (§5.3 POST /execute).
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@loop/observability';
import type { StateStore } from '@loop/state';

const logger = createLogger({ name: 'loop:triggers:manual', component: 'triggers' });

export class ManualTriggerHandler {
  constructor(private store: StateStore) {}

  /** Create a manual execution for a workflow. */
  async trigger(workflowId: string, payload: Record<string, unknown>, userId: string): Promise<string> {
    const executionId = randomUUID();
    await this.store.executions.create({
      id: executionId,
      workflow_id: workflowId,
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: payload,
      initiated_by: userId,
    });
    logger.info({ workflowId, executionId, userId }, 'Manual trigger fired');
    return executionId;
  }
}
