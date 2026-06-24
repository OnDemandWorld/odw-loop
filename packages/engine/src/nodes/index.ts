/**
 * Control flow node handlers — branch, loop, parallel, approval, delay (§6.1, §6.6).
 */

import { createLogger } from '@loop/observability';

const logger = createLogger({ name: 'loop:engine:nodes', component: 'engine' });

// ─── Branch ───────────────────────────────────────────────────────────────────

export class BranchNode {
  /** Evaluate a branch condition and return the selected branch ID. */
  static evaluate(conditions: Array<{ id: string; condition: string }>, context: Record<string, unknown>): string | null {
    for (const branch of conditions) {
      if (this.evalCondition(branch.condition, context)) {
        return branch.id;
      }
    }
    return null;
  }

  private static evalCondition(condition: string, context: Record<string, unknown>): boolean {
    // Simple expression evaluator — in production use a safe expression engine
    try {
      // Replace variable references with values
      const expr = condition.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
        const value = path.split('.').reduce((obj: unknown, key: string) => {
          if (obj && typeof obj === 'object') return (obj as Record<string, unknown>)[key];
          return undefined;
        }, context);
        return JSON.stringify(value);
      });
      // eslint-disable-next-line no-new-func
      return new Function(`return (${expr})`)() as boolean;
    } catch {
      return false;
    }
  }
}

// ─── Loop ─────────────────────────────────────────────────────────────────────

export class LoopNode {
  /** Check if a loop should continue iterating. */
  static shouldContinue(condition: string, context: Record<string, unknown>, iteration: number, maxIterations = 1000): boolean {
    if (iteration >= maxIterations) {
      logger.warn({ iteration, maxIterations }, 'Loop hit max iterations');
      return false;
    }
    return BranchNode.evaluate([{ id: 'continue', condition }], context) === 'continue';
  }
}

// ─── Parallel ─────────────────────────────────────────────────────────────────

export class ParallelNode {
  /** Execute multiple branches in parallel and wait for all to complete. */
  static async executeAll<T>(fns: Array<() => Promise<T>>): Promise<T[]> {
    return Promise.all(fns.map((fn) => fn()));
  }
}

// ─── Approval ─────────────────────────────────────────────────────────────────

export class ApprovalNode {
  /** Pause execution for human approval (returns a waitpoint token). */
  static createWaitpoint(executionId: string, nodeId: string): string {
    return `approval:${executionId}:${nodeId}`;
  }
}

// ─── Delay ────────────────────────────────────────────────────────────────────

export class DelayNode {
  /** Pause execution for a specified duration. */
  static async delay(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }
}
