/**
 * Replay / event-sourcing types (V1.3 M1, F-Loop-1).
 *
 * `ExecutionSnapshot` is the state reconstructed by folding the append-only
 * `execution_events` log (V1.1 M1) back into a per-node view. `ReplayResult`
 * adds the per-node replay decisions produced by a (default read-only) dry-run
 * replay. These are pure data shapes — the folding logic lives in
 * `@loop/engine` (`replay.ts`).
 */

import { z } from 'zod';
import type { ExecutionEventType, ExecutionStatus, NodeExecutionStatus } from './execution.js';

/** Per-node reconstructed state within an execution snapshot. */
export interface NodeSnapshot {
  /** Last known status of the node, folded from its lifecycle events. */
  status: NodeExecutionStatus;
  /**
   * Node output — present when the event stream carries it. Since V1.4 M2 the
   * executor persists the (size-capped) output in the `node_succeeded` payload,
   * so this is populated on reconstruction. An oversized output is surfaced as
   * a `{ __truncated__: true, size, preview }` marker rather than the full
   * payload; old events without an output leave this `undefined`.
   */
  output?: Record<string, unknown>;
  /** Error message — present when the node failed. */
  error?: string;
}

/** A single entry in a snapshot's reconstructed timeline. */
export interface SnapshotTimelineEntry {
  /** The lifecycle event this entry was folded from. */
  type: ExecutionEventType;
  /** Node the event concerns; absent for execution-level events. */
  nodeId?: string;
  /** ISO-8601 timestamp derived from the event's `created_at`. */
  timestamp: string;
  /** Optional human-readable detail (error message / skip reason). */
  detail?: string;
}

/**
 * State of an execution reconstructed from its event log. `nodeStates` is a
 * `Map` keyed by node id (engine-friendly); serialise with
 * `snapshotToJson` (engine) before sending over HTTP.
 */
export interface ExecutionSnapshot {
  executionId: string;
  /** Execution-level status folded from execution_started/succeeded/failed. */
  status: ExecutionStatus;
  /** Per-node reconstructed state, keyed by node id. */
  nodeStates: Map<string, NodeSnapshot>;
  /** ISO-8601 start time (from `execution_started`), when observed. */
  startedAt?: string;
  /** ISO-8601 end time (from a terminal execution event), when observed. */
  endedAt?: string;
  /** Execution-level error (from `execution_failed`), when present. */
  error?: string;
  /** Ordered timeline of every folded event. */
  timeline: SnapshotTimelineEntry[];
}

/** The decision a dry-run replay reaches for a single node. */
export const ReplayDecisionSchema = z.enum([
  'would-run',
  'skipped-because-succeeded',
  'failed',
]);
export type ReplayDecision = z.infer<typeof ReplayDecisionSchema>;

/** A per-node replay decision with its rationale. */
export interface NodeReplayDecision {
  nodeId: string;
  nodeType?: string;
  decision: ReplayDecision;
  /** Why this decision was reached (human-readable). */
  reason: string;
}

/** Outcome of a non-dry-run (real) re-execution, when requested. */
export interface ReplayRerunOutcome {
  status: ExecutionStatus;
  /** Final per-node outputs of the re-run, keyed by node id (when it succeeded). */
  outputs?: Record<string, Record<string, unknown>>;
  /** Error message when the re-run failed. */
  error?: string;
}

/**
 * Result of `replayExecution`. Always carries the reconstructed snapshot and
 * the per-node decisions; `rerun` is populated only when `dryRun === false`.
 */
export interface ReplayResult {
  executionId: string;
  /** True for the default read-only replay; false after a real re-execution. */
  dryRun: boolean;
  snapshot: ExecutionSnapshot;
  decisions: NodeReplayDecision[];
  /** Present only when `dryRun === false` (a real re-execution was performed). */
  rerun?: ReplayRerunOutcome;
}
