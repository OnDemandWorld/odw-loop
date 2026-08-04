/**
 * Execution recovery on application startup (§8.4).
 * Finds interrupted executions and either resumes or marks them as failed.
 *
 * Interrupted = any non-terminal execution owned by the previous (now dead)
 * process: 'running' (died mid-execution) or 'pending' (created but never
 * dispatched). When a dispatcher is injected, recoverable executions are
 * re-dispatched to the executor — resetting to 'pending' alone leaves them
 * stuck because nothing polls the store (bugs 12/13).
 */

import { createLogger } from '@loop/observability';
import type { StateStore } from '@loop/state';
import type { WorkflowExecution } from '@loop/types';
import { recordEvent } from './eventLog.js';

const logger = createLogger({ name: 'loop:engine:recovery', component: 'engine' });

/** Re-dispatches a recovered execution to the executor. */
export type RecoveryDispatcher = (execution: WorkflowExecution) => Promise<void>;

export class ExecutionRecovery {
  constructor(
    private store: StateStore,
    private dispatcher?: RecoveryDispatcher,
  ) {}

  /** Run recovery — called once on startup. */
  async recover(): Promise<{ recovered: number; failed: number }> {
    const interrupted = await this.store.executions.findInterrupted();
    let recovered = 0;
    let failed = 0;

    for (const execution of interrupted) {
      const nodeExecs = await this.store.nodeExecutions.listByExecution(execution.id);
      const lastCompleted = nodeExecs.filter((n) => n.status === 'succeeded').pop();

      if (!lastCompleted && execution.status === 'running') {
        // Died mid-execution with zero completed nodes — the in-flight node's
        // side effects are ambiguous, so re-running is not safe. Mark failed.
        await this.store.executions.updateStatus(execution.id, {
          status: 'failed',
          error: 'Interrupted by system restart',
          completed_at: new Date().toISOString(),
        });
        logger.info({ executionId: execution.id }, 'Marked non-recoverable execution as failed');
        failed++;
        continue;
      }

      // Recoverable: 'running' with completed nodes (resume — the executor
      // skips already-succeeded nodes) or 'pending' that never started.
      const reason = lastCompleted ? 'resume_from_last_succeeded' : 'never_started';
      await this.store.executions.updateStatus(execution.id, {
        status: 'pending',
      });
      // V1.1 M1 (F1): audit the recovery so the resume is traceable.
      await recordEvent(this.store, execution.id, 'execution_recovered', undefined, {
        last_succeeded_node: lastCompleted?.node_id ?? null,
        reason,
      });

      if (this.dispatcher) {
        try {
          await this.dispatcher(execution);
        } catch (err) {
          // Dispatch failed (e.g. workflow archived) — settle to a terminal
          // state instead of leaving the record pending again.
          await this.store.executions.updateStatus(execution.id, {
            status: 'failed',
            error: `Recovery dispatch failed: ${String(err)}`,
            completed_at: new Date().toISOString(),
          });
          logger.warn({ executionId: execution.id, error: String(err) }, 'Recovery dispatch failed');
          failed++;
          continue;
        }
      }

      logger.info(
        { executionId: execution.id, lastNode: lastCompleted?.node_id ?? null, reason },
        'Recovered execution — reset to pending and re-dispatched',
      );
      recovered++;
    }

    logger.info({ recovered, failed, total: interrupted.length }, 'Execution recovery complete');
    return { recovered, failed };
  }
}
