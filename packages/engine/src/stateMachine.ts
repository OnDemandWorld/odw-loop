/**
 * Execution state machine — enforces valid state transitions (§6.1, §4.3).
 */

import { createLogger } from '@loop/observability';

const logger = createLogger({ name: 'loop:engine:stateMachine', component: 'engine' });

export type ExecutionState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'paused';
export type NodeState = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

const EXECUTION_TRANSITIONS: Record<ExecutionState, ExecutionState[]> = {
  pending: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled', 'paused'],
  succeeded: [],
  failed: [],
  cancelled: [],
  paused: ['running', 'cancelled', 'failed'],
};

const NODE_TRANSITIONS: Record<NodeState, NodeState[]> = {
  pending: ['running', 'skipped'],
  running: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
  skipped: [],
};

export class StateMachine {
  /** Validate and apply an execution state transition. Throws on invalid transition. */
  static transitionExecution(from: ExecutionState, to: ExecutionState): void {
    const allowed = EXECUTION_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      throw new Error(`Invalid execution state transition: ${from} → ${to}`);
    }
    logger.debug({ from, to }, 'Execution state transition');
  }

  /** Validate and apply a node state transition. Throws on invalid transition. */
  static transitionNode(from: NodeState, to: NodeState): void {
    const allowed = NODE_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      throw new Error(`Invalid node state transition: ${from} → ${to}`);
    }
    logger.debug({ from, to }, 'Node state transition');
  }

  /** Check if a transition is valid without applying it. */
  static isValidExecutionTransition(from: ExecutionState, to: ExecutionState): boolean {
    return EXECUTION_TRANSITIONS[from]?.includes(to) ?? false;
  }

  static isValidNodeTransition(from: NodeState, to: NodeState): boolean {
    return NODE_TRANSITIONS[from]?.includes(to) ?? false;
  }
}
