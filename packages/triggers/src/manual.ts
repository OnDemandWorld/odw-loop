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
    // Snapshot the workflow's current version so replay resolves the same
    // definition that actually runs (a hardcoded 1 resolved stale versions).
    let workflowVersion = 1;
    try {
      const workflow = await this.store.workflows.getById(workflowId);
      if (workflow) workflowVersion = workflow.version;
    } catch {
      logger.warn({ workflowId }, 'Failed to read workflow version, defaulting to 1');
    }
    await this.store.executions.create({
      id: executionId,
      workflow_id: workflowId,
      workflow_version: workflowVersion,
      trigger_type: 'manual',
      trigger_payload: payload,
      initiated_by: userId,
    });
    logger.info({ workflowId, executionId, userId }, 'Manual trigger fired');
    return executionId;
  }
}
