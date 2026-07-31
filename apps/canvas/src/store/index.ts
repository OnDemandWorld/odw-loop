/**
 * Global state stores (V1.1 M2, F4) — Zustand slices for the Canvas SPA.
 */

export { useWorkflowStore, type WorkflowStore, type CreateWorkflowInput } from './workflows';
export {
  useExecutionStore,
  reduceNodes,
  type ExecutionStore,
  type NodeStatus,
} from './executions';
