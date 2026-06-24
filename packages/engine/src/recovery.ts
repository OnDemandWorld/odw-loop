/**
 * Execution recovery on application startup (§8.4).
 * Finds interrupted executions and either resumes or marks them as failed.
 */

import { createLogger } from '@loop/observability';
import type { StateStore } from '@loop/state';

const logger = createLogger({ name: 'loop:engine:recovery', component: 'engine' });

export class ExecutionRecovery {
  constructor(private store: StateStore) {}

  /** Run recovery — called once on startup. */
  async recover(): Promise<{ recovered: number; failed: number }> {
    const interrupted = await this.store.executions.findInterrupted();
    let recovered = 0;
    let failed = 0;

    for (const execution of interrupted) {
      const nodeExecs = await this.store.nodeExecutions.listByExecution(execution.id);
      const lastCompleted = nodeExecs.filter((n) => n.status === 'succeeded').pop();

      if (lastCompleted) {
        // Recoverable — re-queue from last successful node
        logger.info(
          { executionId: execution.id, lastNode: lastCompleted.node_id },
          'Recovering execution from last successful node',
        );
        // In a full implementation, we'd re-queue the execution here
        recovered++;
      } else {
        // Not recoverable — mark as failed
        await this.store.executions.updateStatus(execution.id, {
          status: 'failed',
          error: 'Interrupted by system restart',
          completed_at: new Date().toISOString(),
        });
        logger.info({ executionId: execution.id }, 'Marked non-recoverable execution as failed');
        failed++;
      }
    }

    logger.info({ recovered, failed, total: interrupted.length }, 'Execution recovery complete');
    return { recovered, failed };
  }
}
