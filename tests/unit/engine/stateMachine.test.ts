import { describe, it, expect } from 'vitest';
import { StateMachine } from '../../../packages/engine/src/stateMachine';
import type { ExecutionState, NodeState } from '../../../packages/engine/src/stateMachine';

describe('StateMachine - Execution State Transitions', () => {
  describe('Valid execution transitions', () => {
    it('should allow pending → running', () => {
      expect(() => StateMachine.transitionExecution('pending', 'running')).not.toThrow();
    });

    it('should allow running → succeeded', () => {
      expect(() => StateMachine.transitionExecution('running', 'succeeded')).not.toThrow();
    });

    it('should allow running → failed', () => {
      expect(() => StateMachine.transitionExecution('running', 'failed')).not.toThrow();
    });

    it('should allow running → cancelled', () => {
      expect(() => StateMachine.transitionExecution('running', 'cancelled')).not.toThrow();
    });

    it('should allow running → paused', () => {
      expect(() => StateMachine.transitionExecution('running', 'paused')).not.toThrow();
    });

    it('should allow paused → running (resume)', () => {
      expect(() => StateMachine.transitionExecution('paused', 'running')).not.toThrow();
    });

    it('should allow paused → cancelled', () => {
      expect(() => StateMachine.transitionExecution('paused', 'cancelled')).not.toThrow();
    });

    it('should allow paused → failed', () => {
      expect(() => StateMachine.transitionExecution('paused', 'failed')).not.toThrow();
    });

    it('should allow pending → cancelled', () => {
      expect(() => StateMachine.transitionExecution('pending', 'cancelled')).not.toThrow();
    });
  });

  describe('Invalid transitions throw', () => {
    it('should throw on pending → succeeded', () => {
      expect(() => StateMachine.transitionExecution('pending', 'succeeded')).toThrow(
        /Invalid execution state transition/
      );
    });

    it('should throw on pending → failed', () => {
      expect(() => StateMachine.transitionExecution('pending', 'failed')).toThrow(
        /Invalid execution state transition/
      );
    });

    it('should throw on succeeded → running', () => {
      expect(() => StateMachine.transitionExecution('succeeded', 'running')).toThrow(
        /Invalid execution state transition/
      );
    });

    it('should throw on failed → running', () => {
      expect(() => StateMachine.transitionExecution('failed', 'running')).toThrow(
        /Invalid execution state transition/
      );
    });

    it('should throw on cancelled → running', () => {
      expect(() => StateMachine.transitionExecution('cancelled', 'running')).toThrow(
        /Invalid execution state transition/
      );
    });

    it('should throw on cancelled → succeeded', () => {
      expect(() => StateMachine.transitionExecution('cancelled', 'succeeded')).toThrow(
        /Invalid execution state transition/
      );
    });

    it('should throw on paused → succeeded', () => {
      expect(() => StateMachine.transitionExecution('paused', 'succeeded')).toThrow(
        /Invalid execution state transition/
      );
    });

    it('should throw on pending → paused', () => {
      expect(() => StateMachine.transitionExecution('pending', 'paused')).toThrow(
        /Invalid execution state transition/
      );
    });
  });

  describe('Cancel from running/paused', () => {
    it('should allow cancel from running state', () => {
      expect(() => StateMachine.transitionExecution('running', 'cancelled')).not.toThrow();
    });

    it('should allow cancel from paused state', () => {
      expect(() => StateMachine.transitionExecution('paused', 'cancelled')).not.toThrow();
    });

    it('should not allow cancel from terminal states', () => {
      expect(() => StateMachine.transitionExecution('succeeded', 'cancelled')).toThrow();
      expect(() => StateMachine.transitionExecution('failed', 'cancelled')).toThrow();
      expect(() => StateMachine.transitionExecution('cancelled', 'cancelled')).toThrow();
    });
  });

  describe('Pause/resume cycle', () => {
    it('should allow pause from running', () => {
      expect(() => StateMachine.transitionExecution('running', 'paused')).not.toThrow();
    });

    it('should allow resume from paused to running', () => {
      expect(() => StateMachine.transitionExecution('paused', 'running')).not.toThrow();
    });

    it('should not allow pause from non-running states', () => {
      expect(() => StateMachine.transitionExecution('pending', 'paused')).toThrow();
      expect(() => StateMachine.transitionExecution('succeeded', 'paused')).toThrow();
      expect(() => StateMachine.transitionExecution('failed', 'paused')).toThrow();
      expect(() => StateMachine.transitionExecution('cancelled', 'paused')).toThrow();
    });
  });
});

describe('StateMachine - Node State Transitions', () => {
  describe('Valid node transitions', () => {
    it('should allow pending → running', () => {
      expect(() => StateMachine.transitionNode('pending', 'running')).not.toThrow();
    });

    it('should allow pending → skipped', () => {
      expect(() => StateMachine.transitionNode('pending', 'skipped')).not.toThrow();
    });

    it('should allow running → succeeded', () => {
      expect(() => StateMachine.transitionNode('running', 'succeeded')).not.toThrow();
    });

    it('should allow running → failed', () => {
      expect(() => StateMachine.transitionNode('running', 'failed')).not.toThrow();
    });
  });

  describe('Invalid node transitions', () => {
    it('should throw on pending → succeeded', () => {
      expect(() => StateMachine.transitionNode('pending', 'succeeded')).toThrow(
        /Invalid node state transition/
      );
    });

    it('should throw on pending → failed', () => {
      expect(() => StateMachine.transitionNode('pending', 'failed')).toThrow(
        /Invalid node state transition/
      );
    });

    it('should throw on succeeded → running', () => {
      expect(() => StateMachine.transitionNode('succeeded', 'running')).toThrow(
        /Invalid node state transition/
      );
    });

    it('should throw on failed → running', () => {
      expect(() => StateMachine.transitionNode('failed', 'running')).toThrow(
        /Invalid node state transition/
      );
    });

    it('should throw on skipped → running', () => {
      expect(() => StateMachine.transitionNode('skipped', 'running')).toThrow(
        /Invalid node state transition/
      );
    });
  });
});

describe('StateMachine - Query methods', () => {
  it('should correctly identify valid execution transitions', () => {
    expect(StateMachine.isValidExecutionTransition('pending', 'running')).toBe(true);
    expect(StateMachine.isValidExecutionTransition('running', 'succeeded')).toBe(true);
    expect(StateMachine.isValidExecutionTransition('pending', 'succeeded')).toBe(false);
    expect(StateMachine.isValidExecutionTransition('succeeded', 'running')).toBe(false);
  });

  it('should correctly identify valid node transitions', () => {
    expect(StateMachine.isValidNodeTransition('pending', 'running')).toBe(true);
    expect(StateMachine.isValidNodeTransition('running', 'succeeded')).toBe(true);
    expect(StateMachine.isValidNodeTransition('pending', 'succeeded')).toBe(false);
    expect(StateMachine.isValidNodeTransition('succeeded', 'running')).toBe(false);
  });
});
