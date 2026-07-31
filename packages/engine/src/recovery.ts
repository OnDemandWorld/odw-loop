/**
 * Execution recovery on application startup (§8.4).
 * Finds interrupted executions and either resumes or marks them as failed.
 */

import { createLogger } from '@loop/observability';
import type { StateStore } from '@loop/state';
import { recordEvent } from './eventLog.js';

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
        // Recoverable — reset to pending so the scheduler can re-queue
        // from the last successful node on next execution cycle.
        await this.store.executions.updateStatus(execution.id, {
          status: 'pending',
        });
        // V1.1 M1 (F1): audit the recovery so the resume is traceable. The
        // executor will skip already-succeeded nodes on the next run.
        await recordEvent(this.store, execution.id, 'execution_recovered', undefined, {
          last_succeeded_node: lastCompleted.node_id,
        });
        logger.info(
          { executionId: execution.id, lastNode: lastCompleted.node_id },
          'Recovered execution — reset to pending for re-queue from last successful node',
        );
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
