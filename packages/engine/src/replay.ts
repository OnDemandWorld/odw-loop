/**
 * Event-sourced replay (V1.3 M1, F-Loop-1).
 *
 * Two capabilities, both built on the append-only `execution_events` log
 * (V1.1 M1):
 *
 *  - `reconstructExecution(store, executionId)` folds the event stream back
 *    into an `ExecutionSnapshot` (execution status + per-node states +
 *    timeline). The fold itself (`foldExecutionEvents`) is a PURE function —
 *    it only reads events and never touches connectors or mutates state.
 *
 *  - `replayExecution(executor, store, executionId, { dryRun })` defaults to a
 *    READ-ONLY dry-run: it reconstructs the snapshot and, against the workflow
 *    definition, decides per node whether a re-run WOULD execute it
 *    (`would-run`), skip it because it already succeeded
 *    (`skipped-because-succeeded`), or marks the prior failure point
 *    (`failed`) — WITHOUT invoking any connector (no side effects). Only when
 *    explicitly asked (`dryRun === false`) does it really re-execute, reusing
 *    the V1.1 resume path (`executor.execute`) that skips succeeded nodes.
 */

import { createLogger } from '@loop/observability';
import type { StateStore } from '@loop/state';
import {
  NotFoundError,
  type ExecutionEvent,
  type ExecutionSnapshot,
  type ExecutionStatus,
  type NodeReplayDecision,
  type NodeSnapshot,
  type ReplayResult,
  type SnapshotTimelineEntry,
  type WorkflowDefinition,
  type WorkflowExecution,
} from '@loop/types';
import type { ExecutionExecutor } from './executor.js';
import { computeLevels } from './scheduler.js';

const logger = createLogger({ name: 'loop:engine:replay', component: 'engine' });

/** Coerce an unknown event-payload value to a plain record, or undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/** Extract a string field from an event payload, or undefined. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * PURE fold of an ordered event stream into an execution snapshot.
 *
 * Reads only the supplied events — no I/O, no side effects — so it is fully
 * deterministic and trivially testable: the same event sequence always yields
 * the same snapshot. Events are expected in ascending `created_at` order (as
 * returned by `events.listByExecution`); later events win for a given node.
 */
export function foldExecutionEvents(executionId: string, events: ExecutionEvent[]): ExecutionSnapshot {
  const nodeStates = new Map<string, NodeSnapshot>();
  const timeline: SnapshotTimelineEntry[] = [];
  let status: ExecutionStatus = 'pending';
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let error: string | undefined;

  const setNode = (nodeId: string, patch: NodeSnapshot): void => {
    const existing = nodeStates.get(nodeId);
    nodeStates.set(nodeId, { ...existing, ...patch });
  };

  for (const event of events) {
    const timestamp = new Date(event.created_at).toISOString();
    const payload = event.payload ?? {};
    const nodeId = event.node_id ?? undefined;
    let detail: string | undefined;

    switch (event.event_type) {
      case 'execution_started':
        status = 'running';
        startedAt = timestamp;
        break;
      case 'execution_recovered':
        // A recovered execution is re-queued for resume → treat as running.
        status = 'running';
        detail = asString(payload['last_succeeded_node']);
        break;
      case 'execution_succeeded':
        status = 'succeeded';
        endedAt = timestamp;
        break;
      case 'execution_failed':
        status = 'failed';
        endedAt = timestamp;
        error = asString(payload['error']) ?? error;
        detail = error;
        break;
      case 'node_started':
        if (nodeId) setNode(nodeId, { status: 'running' });
        break;
      case 'node_succeeded': {
        if (nodeId) {
          const output = asRecord(payload['output']);
          setNode(nodeId, { status: 'succeeded', ...(output !== undefined ? { output } : {}) });
        }
        break;
      }
      case 'node_failed': {
        const nodeError = asString(payload['error']);
        if (nodeId) {
          setNode(nodeId, { status: 'failed', ...(nodeError !== undefined ? { error: nodeError } : {}) });
        }
        detail = nodeError;
        break;
      }
      case 'node_skipped':
        if (nodeId) setNode(nodeId, { status: 'skipped' });
        detail = asString(payload['reason']);
        break;
      default:
        // Unknown future event types are still recorded on the timeline.
        break;
    }

    timeline.push({
      type: event.event_type,
      ...(nodeId !== undefined ? { nodeId } : {}),
      timestamp,
      ...(detail !== undefined ? { detail } : {}),
    });
  }

  return {
    executionId,
    status,
    nodeStates,
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(endedAt !== undefined ? { endedAt } : {}),
    ...(error !== undefined ? { error } : {}),
    timeline,
  };
}

/**
 * Reconstruct an execution's state from its event log (read-only).
 * Thin async wrapper over the pure `foldExecutionEvents`.
 */
export async function reconstructExecution(store: StateStore, executionId: string): Promise<ExecutionSnapshot> {
  const events = await store.events.listByExecution(executionId);
  return foldExecutionEvents(executionId, events);
}

/**
 * Resolve the workflow definition an execution ran, preferring the exact
 * version snapshot (`workflowDefinitions`) and falling back to the live
 * workflow definition. Throws NOT_FOUND_WORKFLOW when neither is available.
 */
async function resolveDefinition(store: StateStore, execution: WorkflowExecution): Promise<WorkflowDefinition> {
  const versioned = await store.workflowDefinitions.getByWorkflowAndVersion(
    execution.workflow_id,
    execution.workflow_version,
  );
  if (versioned) return versioned.definition;

  const workflow = await store.workflows.getById(execution.workflow_id);
  if (workflow) return workflow.definition;

  throw new NotFoundError('WORKFLOW', execution.workflow_id);
}

/**
 * Compute the dry-run replay decision for every node in the definition, in
 * topological order. Mirrors the V1.1 resume semantics: succeeded/skipped
 * nodes are NOT re-dispatched; everything else (failed / running / never-run)
 * WOULD run. A previously-failed node is surfaced as `failed` (the failure
 * point that a real re-run would retry).
 */
export function computeReplayDecisions(
  definition: WorkflowDefinition,
  snapshot: ExecutionSnapshot,
): NodeReplayDecision[] {
  const ordered = computeLevels(definition.nodes, definition.edges).flat();
  const decisions: NodeReplayDecision[] = [];

  for (const node of ordered) {
    const state = snapshot.nodeStates.get(node.id);
    let decision: NodeReplayDecision['decision'];
    let reason: string;

    if (state === undefined || state.status === 'pending' || state.status === 'running') {
      decision = 'would-run';
      reason =
        state === undefined
          ? 'never reached in the original run — would execute on replay'
          : `last seen '${state.status}' (not completed) — would execute on replay`;
    } else if (state.status === 'succeeded' || state.status === 'skipped') {
      decision = 'skipped-because-succeeded';
      reason = `already '${state.status}' — resume skips re-dispatch (no side effects)`;
    } else {
      decision = 'failed';
      reason = state.error
        ? `previously failed (${state.error}) — would be retried on re-execution`
        : 'previously failed — would be retried on re-execution';
    }

    decisions.push({
      nodeId: node.id,
      nodeType: node.type,
      decision,
      reason,
    });
  }

  return decisions;
}

/** Options for `replayExecution`. */
export interface ReplayOptions {
  /**
   * Default `true` — read-only replay that produces decisions WITHOUT invoking
   * connectors. Set `false` to really re-execute via the V1.1 resume path.
   */
  dryRun?: boolean;
}

/**
 * Replay an execution.
 *
 * Default (`dryRun === true`): reconstruct the snapshot and compute per-node
 * decisions only — NO connector is invoked and NO state is mutated, so the
 * replay is side-effect-free and safe for audit / fault reproduction.
 *
 * With `dryRun === false`: re-execute via `executor.execute`, which reuses the
 * V1.1 resume path (already-succeeded nodes are skipped, only the remainder is
 * re-dispatched). The re-run outcome is attached as `rerun`.
 */
export async function replayExecution(
  executor: ExecutionExecutor,
  store: StateStore,
  executionId: string,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const dryRun = options.dryRun !== false; // default true

  const execution = await store.executions.getById(executionId);
  if (!execution) {
    throw new NotFoundError('EXECUTION', executionId);
  }

  const snapshot = await reconstructExecution(store, executionId);
  const definition = await resolveDefinition(store, execution);
  const decisions = computeReplayDecisions(definition, snapshot);

  if (dryRun) {
    logger.info({ executionId, nodes: decisions.length }, 'Dry-run replay (read-only, no side effects)');
    return { executionId, dryRun: true, snapshot, decisions };
  }

  // Real re-execution via the V1.1 resume path (skips succeeded nodes).
  logger.info({ executionId }, 'Replaying execution (dryRun=false) — re-executing non-succeeded nodes');
  try {
    const outputs = await executor.execute(executionId, definition, execution.trigger_payload ?? {});
    const after = await store.executions.getById(executionId);
    return {
      executionId,
      dryRun: false,
      snapshot,
      decisions,
      rerun: {
        status: after?.status ?? 'running',
        outputs: Object.fromEntries(outputs),
      },
    };
  } catch (err) {
    const message = String(err);
    return {
      executionId,
      dryRun: false,
      snapshot,
      decisions,
      rerun: { status: 'failed', error: message },
    };
  }
}

/**
 * Serialise a snapshot's `nodeStates` Map into a plain record for JSON
 * transport (HTTP responses). Everything else passes through unchanged.
 */
export function snapshotToJson(snapshot: ExecutionSnapshot): Omit<ExecutionSnapshot, 'nodeStates'> & {
  nodeStates: Record<string, NodeSnapshot>;
} {
  return { ...snapshot, nodeStates: Object.fromEntries(snapshot.nodeStates) };
}
