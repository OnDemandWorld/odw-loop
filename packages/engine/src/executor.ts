/**
 * Main execution executor — processes nodes in topological order (§6.1).
 */

import { randomUUID, createHash } from 'node:crypto';
import { createLogger } from '@loop/observability';
import { metricsRegistry } from '@loop/observability';
// V1.6 M1 (F-2, SP3): execution/node lifecycle spans (best-effort observability).
import { startSpan, runInSpan } from '@loop/observability';
import { LoopError, type WorkflowDefinition, type WorkflowNode, type ExecutionStatus } from '@loop/types';
import type { StateStore } from '@loop/state';
import type { ConnectorRegistry } from '@loop/connectors';
import { computeLevels, topologicalSort } from './scheduler.js';
import { executeWithRetry, type RetryConfig } from './retry.js';
import { BranchNode, DelayNode } from './nodes/index.js';
import { recordEvent } from './eventLog.js';
import { EventBus, executionEventBus, type ExecutionBusEvent } from './eventBus.js';

const logger = createLogger({ name: 'loop:engine:executor', component: 'engine' });
const metrics = metricsRegistry();

/** Default workflow-level timeout (V1.1 M1, F3). Env-overridable, 300s fallback. */
function defaultWorkflowTimeoutMs(): number {
  const raw = process.env['LOOP_WORKFLOW_TIMEOUT_MS'];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
}

/**
 * Default sub-workflow recursion ceiling (V1.2 M3, F-Loop-1). Env-overridable,
 * 5 fallback — bounds `workflow.invoke` nesting so a cyclic definition cannot
 * recurse without limit.
 */
function defaultMaxSubWorkflowDepth(): number {
  const raw = process.env['LOOP_SUBWORKFLOW_MAX_DEPTH'];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

/**
 * Default size cap (bytes) for the node output persisted into a
 * `node_succeeded` event payload (V1.4 M2, F-2). Env-overridable, 64KB
 * fallback — bounds what a single event may store so large outputs cannot
 * bloat the append-only `execution_events` table.
 */
function defaultEventOutputMaxBytes(): number {
  const raw = process.env['LOOP_EVENT_OUTPUT_MAX_BYTES'];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 65_536;
}

/** Leading characters of the serialised output retained in a truncated marker. */
const EVENT_OUTPUT_PREVIEW_CHARS = 1024;

/**
 * V1.4 M2 (F-2): cap a node output for persistence into a `node_succeeded`
 * event payload. When the JSON-serialised output fits within `maxBytes` it is
 * returned unchanged; otherwise a small truncated marker
 * `{ __truncated__: true, size, preview }` is returned instead, so oversized
 * outputs cannot bloat the append-only events table. `size` is the original
 * serialised byte length; `preview` is a short leading slice of the JSON.
 */
function capOutputForEvent(
  output: Record<string, unknown>,
  maxBytes: number,
): Record<string, unknown> {
  const serialized = JSON.stringify(output) ?? '';
  const size = Buffer.byteLength(serialized, 'utf8');
  if (size <= maxBytes) {
    return output;
  }
  const preview = serialized.slice(0, Math.max(0, Math.min(EVENT_OUTPUT_PREVIEW_CHARS, maxBytes)));
  return { __truncated__: true, size, preview };
}

export interface ExecutorContext {
  executionId: string;
  workflowId: string;
  triggerPayload: Record<string, unknown>;
  nodeOutputs: Map<string, Record<string, unknown>>;
  /**
   * V1.1 M1 (F1/F2): outputs of nodes already `succeeded` for this execution,
   * loaded at start. Used to skip re-dispatch on resume / idempotent retry.
   */
  completedOutputs: Map<string, Record<string, unknown>>;
  /**
   * V1.2 M3 (F-Loop-1): sub-workflow recursion depth. `0` for a root execution;
   * each `workflow.invoke` child runs at parent depth + 1 and is rejected past
   * `maxSubWorkflowDepth`.
   */
  depth: number;
  /**
   * V1.2 M3: the execution that invoked this one as a sub-workflow. Absent for
   * root executions; stamped onto every emitted event so monitors can rebuild
   * the parent→child tree.
   */
  parentExecutionId?: string;
  /**
   * V1.2 M3: definition keys already on the invocation stack — used for cycle
   * detection so a self-invoking workflow fails fast instead of recursing to
   * the depth ceiling.
   */
  visited: Set<string>;
  /**
   * V1.7 (branch wiring): runtime decision of each executed `control.branch`
   * node — which outgoing port ('true'/'false') fired. Scheduler-level pruning
   * reads this to drop nodes reachable only via the non-taken port.
   */
  branchDecisions: Map<string, 'true' | 'false'>;
  /**
   * V1.7 (branch wiring): nodes pruned this run because every incoming edge
   * comes from a non-taken branch port (directly or transitively). Edges out
   * of a skipped node are dead, so pruning cascades level by level.
   */
  skippedNodes: Set<string>;
  /**
   * V1.7 (L-6): `definition.variables` defaults resolved once per execution —
   * backs `{{variables.*}}` interpolation in both configs and branch conditions.
   */
  variables: Record<string, unknown>;
}

/**
 * V1.2 M3 (F-Loop-1): optional recursion context threaded through
 * `execute()` for sub-workflow invocation. Root callers omit it entirely
 * (backward compatible); the engine supplies it when recursing into a child.
 */
export interface ExecuteOptions {
  /** Recursion depth of this execution (default 0 = root). */
  depth?: number;
  /** Parent execution id when this execution is a sub-workflow invocation. */
  parentExecutionId?: string;
  /** Definition keys already on the invocation stack (cycle detection). */
  visited?: Set<string>;
}

export class ExecutionExecutor {
  constructor(
    private store: StateStore,
    private connectors: ConnectorRegistry,
    private maxConcurrent = 50,
    private nodeTimeoutMs = 30_000,
    private workflowTimeoutMs: number = defaultWorkflowTimeoutMs(),
    // V1.1 M2 (F5): real-time status fan-out. Defaults to the process-wide
    // singleton the WS route subscribes to; inject a dedicated bus in tests.
    private eventBus: EventBus = executionEventBus,
    // V1.2 M3 (F-Loop-1): ceiling for `workflow.invoke` recursion depth.
    private maxSubWorkflowDepth: number = defaultMaxSubWorkflowDepth(),
    // V1.4 M2 (F-2): size cap (bytes) for the node output persisted into a
    // `node_succeeded` event payload. Oversized outputs are stored as a
    // truncated marker instead of the full payload (see capOutputForEvent).
    private eventOutputMaxBytes: number = defaultEventOutputMaxBytes(),
    // Egress policy gate enforced before every outbound connector call.
    // Structural type — the engine does not depend on @loop/egress.
    private egressGate?: { check(url: string): Promise<void> },
    // V1.7 (L-2 secrets wiring): resolves a named secret for a connector
    // instance from the encrypted secrets store, before falling back to the
    // instance's inline config. Supplied by the API server; absent in tests.
    private secretResolver?: (name: string, scope: 'connector', scopeId: string) => Promise<string | null>,
    // V1.7 (L-9): executor-wide default retry applied when a node carries no
    // explicit `retry` block. Backward compatible — omitted keeps the historic
    // zero-retry behaviour (the API server passes LOOP_DEFAULT_RETRY_*).
    private defaultRetry?: RetryConfig,
  ) {}

  /** V1.7 (L-10): in-flight executions on this executor (see drain()). */
  private activeRuns = 0;

  /**
   * V1.7 (L-10): wait for in-flight executions to settle (bounded). The API
   * server's SIGTERM path drains before app.close() so side effects are not
   * severed mid-flight; recovery remains the safety net for the remainder.
   */
  async drain(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.activeRuns > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.activeRuns === 0;
  }

  /**
   * Publish a real-time node/execution status event (V1.1 M2, F5). Best-effort:
   * the EventBus isolates listener errors, so this can never break execution.
   */
  private emit(event: ExecutionBusEvent): void {
    this.eventBus.publish(event);
  }

  /**
   * V1.2 M3 (F-Loop-1): the partial event fields that tag an event as belonging
   * to a sub-workflow invocation. Spread into every emitted event so a monitor
   * can reconstruct the parent→child execution tree. Empty for root executions.
   */
  private parentMarker(ctx: ExecutorContext): { parentExecutionId?: string } {
    return ctx.parentExecutionId !== undefined ? { parentExecutionId: ctx.parentExecutionId } : {};
  }

  /**
   * Execute a workflow from start to finish. Resolves with the final per-node
   * output map so a `workflow.invoke` parent can surface a child's outputs
   * (V1.2 M3); root callers may ignore the return value. `options` carries
   * sub-workflow recursion state and is supplied by the engine itself when it
   * recurses into a child — external callers leave it unset.
   *
   * V1.6 M1 (F-2, SP3): the whole run is wrapped in a `loop.execution` span;
   * every node span started below it is auto-parented to that span via the
   * tracing AsyncLocalStorage context. Best-effort — tracing never changes
   * the execution result, and an unsampled/no-op span makes this a thin
   * pass-through.
   */
  async execute(
    executionId: string,
    definition: WorkflowDefinition,
    triggerPayload: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<Map<string, Record<string, unknown>>> {
    const span = startSpan('loop.execution', {
      'execution.id': executionId,
      'workflow.id': definition.metadata?.name ?? '',
      'execution.depth': options?.depth ?? 0,
    });
    let failed = false;
    try {
      return await runInSpan(span, () =>
        this.executeInner(executionId, definition, triggerPayload, options),
      );
    } catch (err) {
      failed = true;
      span.setAttr('error.message', String(err));
      throw err;
    } finally {
      span.end(failed ? 'error' : 'ok');
    }
  }

  /** The execution pipeline proper (see `execute` for the public contract). */
  private async executeInner(
    executionId: string,
    definition: WorkflowDefinition,
    triggerPayload: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<Map<string, Record<string, unknown>>> {
    const startTime = Date.now();
    // V1.7 (L-6): resolve `definition.variables` defaults once so both config
    // interpolation and branch conditions can reference `{{variables.*}}`.
    const variables: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(definition.variables ?? {})) {
      variables[name] = (def as { default?: unknown } | undefined)?.default;
    }
    const ctx: ExecutorContext = {
      executionId,
      workflowId: definition.metadata?.name ?? '',
      triggerPayload,
      nodeOutputs: new Map(),
      completedOutputs: new Map(),
      depth: options?.depth ?? 0,
      ...(options?.parentExecutionId !== undefined ? { parentExecutionId: options.parentExecutionId } : {}),
      visited: options?.visited ?? new Set<string>(),
      branchDecisions: new Map(),
      skippedNodes: new Set(),
      variables,
    };
    this.activeRuns++;

    // V1.1 M1 (F1 resume / F2 idempotency): seed the context with outputs of
    // nodes that already succeeded for this execution so a resumed run skips
    // them instead of re-dispatching (and re-triggering side effects).
    await this.loadCompletedOutputs(executionId, ctx);

    // Transition execution to running
    await this.store.executions.updateStatus(executionId, {
      status: 'running',
      started_at: new Date().toISOString(),
    });
    metrics.activeExecutions.inc();
    await recordEvent(this.store, executionId, 'execution_started', undefined, {
      resumed: ctx.completedOutputs.size > 0,
    });
    this.emit({
      type: 'execution_started',
      executionId,
      status: 'running',
      timestamp: new Date().toISOString(),
      ...this.parentMarker(ctx),
    });

    // V1.1 M1 (F3): bound the WHOLE execution with a workflow-level timeout.
    // Per-definition `settings.workflow_timeout_ms` wins over the executor default.
    // Audit #68: clamp to the setTimeout maximum — stored definitions predating
    // the schema cap could still carry overflowing values (fire after ~1ms).
    const workflowTimeoutMs = Math.min(definition.settings?.workflow_timeout_ms ?? this.workflowTimeoutMs, 2_147_483_647);
    const controller = new AbortController();
    let workflowTimedOut = false;
    const timer = setTimeout(() => {
      workflowTimedOut = true;
      controller.abort();
    }, workflowTimeoutMs);

    try {
      // Group nodes into topological levels; nodes within a level have no
      // inter-dependencies and run in parallel (§6.2). Levels run sequentially
      // so downstream nodes observe upstream outputs.
      const levels = computeLevels(definition.nodes, definition.edges);

      if (levels.length === 0) {
        // Empty workflow succeeds immediately
        await this.completeExecution(executionId, 'succeeded', startTime, undefined, ctx.workflowId, ctx.parentExecutionId);
        await recordEvent(this.store, executionId, 'execution_succeeded');
        return ctx.nodeOutputs;
      }

      for (const level of levels) {
        // Cooperative cancellation (M3): the API cancel route flips the row to
        // 'cancelled'; stop scheduling further levels instead of racing it.
        const current = await this.store.executions.getById(executionId);
        if (current?.status === 'cancelled') {
          throw new LoopError('EXECUTION_CANCELLED', `Execution '${executionId}' was cancelled`, 400);
        }
        // V1.7 (branch wiring): prune nodes whose every incoming edge is off a
        // non-taken branch port (or descends from a pruned node) BEFORE the
        // level runs — a decided branch must not execute both arms.
        const activeLevel = await this.pruneInactiveNodes(level, ctx, definition);
        const settled = await this.executeLevel(activeLevel, ctx, definition, controller.signal);
        // Audit #10: the workflow deadline can fire while no node is in flight
        // (during the store reads/pruning above, or between batches). In that
        // case executeLevel returns no rejected result, so without this check
        // the run would complete 'succeeded' with most nodes never executed.
        if (controller.signal.aborted) {
          throw new LoopError(
            'WORKFLOW_TIMEOUT',
            `Workflow '${executionId}' timed out after ${workflowTimeoutMs}ms (workflow_timeout)`,
            500,
          );
        }
        // Abort the execution on the first node failure in this level; later
        // levels must not run (mirrors the previous fail-fast semantics).
        const failure = settled.find((r) => r.status === 'rejected');
        if (failure) {
          throw (failure as PromiseRejectedResult).reason;
        }
      }

      await this.completeExecution(executionId, 'succeeded', startTime, undefined, ctx.workflowId, ctx.parentExecutionId);
      await recordEvent(this.store, executionId, 'execution_succeeded');
      return ctx.nodeOutputs;
    } catch (err) {
      // A workflow-level timeout supersedes the underlying node abort error so
      // the persisted reason is unambiguous.
      const errorMsg = workflowTimedOut
        ? `Workflow '${executionId}' timed out after ${workflowTimeoutMs}ms (workflow_timeout)`
        : String(err);
      const finalErr = workflowTimedOut
        ? new LoopError('WORKFLOW_TIMEOUT', errorMsg, 500)
        : err;
      logger.error({ executionId, error: errorMsg }, 'Execution failed');
      await this.completeExecution(executionId, 'failed', startTime, errorMsg, ctx.workflowId, ctx.parentExecutionId);
      await recordEvent(this.store, executionId, 'execution_failed', undefined, {
        error: errorMsg,
        reason: workflowTimedOut ? 'workflow_timeout' : 'node_error',
      });
      throw finalErr;
    } finally {
      clearTimeout(timer);
      metrics.activeExecutions.dec();
      this.activeRuns--;
    }
  }

  /**
   * V1.7 (branch wiring): drop level nodes that are unreachable under the
   * branch decisions taken so far. A node is inactive when it HAS incoming
   * edges and every one of them is dead: an edge is dead when its source was
   * pruned, or when its source is a decided branch node and the edge's
   * `source_port` is not the taken port. Roots (no incoming edges) always run;
   * merge nodes survive on any single live incoming edge. Pruned nodes get a
   * `skipped` node_executions row + event so replay shows why they never ran,
   * and are recorded in `ctx.skippedNodes` so their own outgoing edges die
   * (pruning cascades through subsequent levels).
   */
  private async pruneInactiveNodes(
    level: WorkflowNode[],
    ctx: ExecutorContext,
    definition: WorkflowDefinition,
  ): Promise<WorkflowNode[]> {
    const active: WorkflowNode[] = [];
    for (const node of level) {
      const incoming = (definition.edges ?? []).filter((e) => e.target === node.id);
      const live = incoming.some((e) => {
        if (ctx.skippedNodes.has(e.source)) return false;
        const decision = ctx.branchDecisions.get(e.source);
        if (decision === undefined) return true;
        return e.source_port === decision;
      });
      if (live || incoming.length === 0) {
        active.push(node);
        continue;
      }
      ctx.skippedNodes.add(node.id);
      // Audit #9: resume/replay re-prunes the same nodes under the SAME
      // execution id. The idempotency_key unique index (idx_node_exec_idem)
      // rejects a second insert, so reuse the prior 'skipped' row instead —
      // mirroring the findByIdempotencyKey guard in executeNodeInner.
      const idemKey = `${ctx.executionId}:${node.id}`;
      const existingSkipped = await this.store.nodeExecutions.findByIdempotencyKey(idemKey);
      if (!existingSkipped) {
        const nodeExecId = randomUUID();
        await this.store.nodeExecutions.create({
          id: nodeExecId,
          execution_id: ctx.executionId,
          node_id: node.id,
          node_type: node.type,
          input: node.config,
          idempotency_key: idemKey,
        });
        await this.store.nodeExecutions.updateStatus(nodeExecId, {
          status: 'skipped',
          completed_at: new Date().toISOString(),
        });
      }
      await recordEvent(this.store, ctx.executionId, 'node_skipped', node.id, {
        reason: 'branch_not_taken',
      });
      this.emit({
        type: 'node_skipped',
        executionId: ctx.executionId,
        nodeId: node.id,
        nodeType: node.type,
        status: 'skipped',
        timestamp: new Date().toISOString(),
        ...this.parentMarker(ctx),
      });
      logger.info({ executionId: ctx.executionId, nodeId: node.id }, 'Node skipped — branch not taken');
    }
    return active;
  }

  /**
   * Load already-succeeded node outputs for an execution into the context so
   * resume / idempotent retry can skip them. Best-effort: a read failure simply
   * leaves the maps empty (the run proceeds as a fresh execution).
   */
  private async loadCompletedOutputs(executionId: string, ctx: ExecutorContext): Promise<void> {
    try {
      const existing = await this.store.nodeExecutions.listByExecution(executionId);
      for (const ne of existing) {
        if (ne.status === 'succeeded') {
          ctx.completedOutputs.set(ne.node_id, ne.output);
          // Also expose to downstream variable interpolation ({{node_X.output.*}}).
          ctx.nodeOutputs.set(ne.node_id, ne.output);
        }
      }
    } catch (err) {
      logger.warn({ executionId, error: String(err) }, 'Failed to preload completed node outputs — running fresh');
    }
  }

  /**
   * Execute every node in a topological level concurrently, bounded by
   * `maxConcurrent`. Uses Promise.allSettled so one failing node does not
   * prevent its siblings from completing; the caller inspects the settled
   * results and fails the execution if any node rejected.
   */
  private async executeLevel(
    level: WorkflowNode[],
    ctx: ExecutorContext,
    definition: WorkflowDefinition,
    signal?: AbortSignal,
  ): Promise<PromiseSettledResult<void>[]> {
    const limit = Math.max(1, this.maxConcurrent);
    const settled: PromiseSettledResult<void>[] = [];

    for (let i = 0; i < level.length; i += limit) {
      // Stop scheduling further batches once the workflow deadline has passed —
      // nodes in later batches would otherwise fire connector calls nobody
      // awaits (side effects continuing after timeout).
      if (signal?.aborted) break;
      const batch = level.slice(i, i + limit);
      const batchResults = await Promise.allSettled(
        batch.map((node) => this.executeNode(node, ctx, definition, signal)),
      );
      settled.push(...batchResults);
    }

    return settled;
  }

  /**
   * Bound a node execution with a timeout. The caller-supplied controller is
   * aborted when the deadline elapses (so the in-flight connector call — which
   * observes the same signal — stops making network calls) and the returned
   * promise rejects with a NODE_TIMEOUT error, so a hung adapter cannot stall
   * the whole execution. An externally aborted controller (workflow-level
   * timeout) rejects with WORKFLOW_TIMEOUT.
   *
   * V1.1 M1 (F3): the workflow-level timeout aborts the controller, so every
   * in-flight node rejects with a WORKFLOW_TIMEOUT error instead of hanging.
   */
  private withTimeout<T>(controller: AbortController, promise: Promise<T>, ms: number, nodeId: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Always attach a no-op rejection handler first: if the controller is
      // already aborted (or aborts before the promise settles) the main
      // `promise.then` below may never attach, and an unhandled rejection
      // would crash the process (Node ≥15 default).
      promise.catch(() => {});

      // Distinguish the two abort causes: when the timer fires it aborts the
      // same controller this promise listens on, so the listener must not
      // race it to the rejection with a WORKFLOW_TIMEOUT.
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new LoopError('NODE_TIMEOUT', `Node '${nodeId}' timed out after ${ms}ms`, 500));
      }, ms);

      const onAbort = (): void => {
        if (timedOut) return;
        clearTimeout(timer);
        reject(new LoopError('WORKFLOW_TIMEOUT', `Node '${nodeId}' aborted by workflow timeout (workflow_timeout)`, 500));
      };

      if (controller.signal.aborted) {
        clearTimeout(timer);
        onAbort();
        return;
      }
      controller.signal.addEventListener('abort', onAbort, { once: true });

      const cleanup = (): void => {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
      };

      promise.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (err) => {
          cleanup();
          reject(err);
        },
      );
    });
  }

  /**
   * V1.6 M1 (F-2, SP3): wrap the node lifecycle in a `loop.node` span. Started
   * inside the active `loop.execution` context, so it is auto-parented to the
   * execution span; a `workflow.invoke` child execution started below it is in
   * turn parented to this node span. Best-effort — never changes node results.
   */
  private async executeNode(
    node: WorkflowNode,
    ctx: ExecutorContext,
    definition: WorkflowDefinition,
    signal?: AbortSignal,
  ): Promise<void> {
    const span = startSpan('loop.node', {
      'node.id': node.id,
      'node.type': node.type,
      'execution.id': ctx.executionId,
    });
    let failed = false;
    try {
      return await runInSpan(span, () => this.executeNodeInner(node, ctx, definition, signal));
    } catch (err) {
      failed = true;
      span.setAttr('error.message', String(err));
      throw err;
    } finally {
      span.end(failed ? 'error' : 'ok');
    }
  }

  private async executeNodeInner(node: WorkflowNode, ctx: ExecutorContext, _definition: WorkflowDefinition, signal?: AbortSignal): Promise<void> {
    // Workflow deadline already passed — do not start new connector work.
    if (signal?.aborted) {
      throw new LoopError('WORKFLOW_TIMEOUT', `Node '${node.id}' aborted by workflow timeout (workflow_timeout)`, 500);
    }

    // V1.1 M1 (F1 resume / F2 idempotency): if this node already succeeded for
    // this execution, skip dispatch entirely and reuse its stored output — no
    // connector call, no duplicate side effects.
    const completed = ctx.completedOutputs.get(node.id);
    if (completed !== undefined) {
      ctx.nodeOutputs.set(node.id, completed);
      this.restoreBranchDecision(node, completed, ctx);
      logger.info({ executionId: ctx.executionId, nodeId: node.id }, 'Skipping already-succeeded node (resume/idempotent)');
      await recordEvent(this.store, ctx.executionId, 'node_skipped', node.id, { reason: 'already_succeeded' });
      this.emit({
        type: 'node_skipped',
        executionId: ctx.executionId,
        nodeId: node.id,
        nodeType: node.type,
        status: 'skipped',
        timestamp: new Date().toISOString(),
        ...this.parentMarker(ctx),
      });
      return;
    }

    const startTime = Date.now();
    // V1.1 M1 (F2): stable idempotency key per (execution, node).
    const idempotencyKey = `${ctx.executionId}:${node.id}`;

    // Resolve the node-execution row to write against. If a prior interrupted
    // attempt already created a row for this key, reuse it (reset to running)
    // instead of inserting a duplicate — the unique index on idempotency_key
    // would otherwise reject the insert. A succeeded row found here is treated
    // as an idempotent hit and skipped.
    let nodeExecId: string;
    const existingByKey = await this.store.nodeExecutions.findByIdempotencyKey(idempotencyKey);
    if (existingByKey) {
      if (existingByKey.status === 'succeeded') {
        ctx.nodeOutputs.set(node.id, existingByKey.output);
        ctx.completedOutputs.set(node.id, existingByKey.output);
        this.restoreBranchDecision(node, existingByKey.output, ctx);
        await recordEvent(this.store, ctx.executionId, 'node_skipped', node.id, { reason: 'idempotent_hit' });
        this.emit({
          type: 'node_skipped',
          executionId: ctx.executionId,
          nodeId: node.id,
          nodeType: node.type,
          status: 'skipped',
          timestamp: new Date().toISOString(),
          ...this.parentMarker(ctx),
        });
        return;
      }
      nodeExecId = existingByKey.id;
      await this.store.nodeExecutions.updateStatus(nodeExecId, {
        status: 'running',
        started_at: new Date().toISOString(),
        retry_count: existingByKey.retry_count + 1,
      });
    } else {
      nodeExecId = randomUUID();
      await this.store.nodeExecutions.create({
        id: nodeExecId,
        execution_id: ctx.executionId,
        node_id: node.id,
        node_type: node.type,
        input: node.config,
        idempotency_key: idempotencyKey,
      });
      await this.store.nodeExecutions.updateStatus(nodeExecId, {
        status: 'running',
        started_at: new Date().toISOString(),
      });
    }

    await recordEvent(this.store, ctx.executionId, 'node_started', node.id);
    this.emit({
      type: 'node_started',
      executionId: ctx.executionId,
      nodeId: node.id,
      nodeType: node.type,
      status: 'running',
      timestamp: new Date().toISOString(),
      ...this.parentMarker(ctx),
    });

    try {
      // V1.7 (branch wiring): `control.branch` is evaluated on the RAW
      // condition, before resolveVariables — generic interpolation strips the
      // {{…}} quotes and would turn string comparisons into bare-word (falsy)
      // references, inverting the branch semantics.
      let resolvedInput: Record<string, unknown>;
      if (node.type === 'workflow.invoke') {
        // Deep interpolation must NOT descend into the inline child
        // `definition` — its own {{trigger.payload.*}} references resolve
        // against the CHILD's payload at execution, not the parent's here
        // (pre-interpolating them with the parent context blanked the child's
        // references). `inputs` IS interpolated: parent values flow in.
        resolvedInput = {};
        for (const [key, value] of Object.entries(node.config)) {
          resolvedInput[key] = key === 'definition' ? value : this.resolveValue(value, ctx);
        }
      } else if (node.type === 'control.branch') {
        const condition = typeof node.config['condition'] === 'string' ? (node.config['condition'] as string) : '';
        const met = BranchNode.evaluateBranch(condition, this.branchContext(ctx));
        const decision: 'true' | 'false' = met ? 'true' : 'false';
        ctx.branchDecisions.set(node.id, decision);
        resolvedInput = { condition, condition_met: met, branch: decision };
      } else {
        // Resolve variable interpolation
        resolvedInput = this.resolveVariables(node.config, ctx);
      }

      // A per-node controller fuses the workflow-level signal with the node
      // timeout: both abort THIS controller, and the fused signal is what the
      // connector observes — so a timed-out node stops making HTTP calls
      // instead of continuing its side effects in the background.
      const controller = new AbortController();
      const forwardAbort = (): void => controller.abort();
      if (signal?.aborted) controller.abort();
      else signal?.addEventListener('abort', forwardAbort, { once: true });

      // Execute with retry, bounded by the node timeout (per-node override or
      // the executor-wide default). Retries stop once the controller aborts.
      try {
        const retryConfig = node.retry ?? this.defaultRetry ?? { max_attempts: 0, backoff: 'fixed' as const, initial_delay_ms: 0 };
        // Audit #67: clamp to the setTimeout maximum (see workflow timeout).
        const timeoutMs = Math.min(node.timeout_ms ?? this.nodeTimeoutMs, 2_147_483_647);
        const result = await this.withTimeout(
          controller,
          executeWithRetry(
            async () => this.dispatchNode(node, resolvedInput, ctx, idempotencyKey, controller.signal),
            retryConfig,
            (attempt, error) => {
              logger.warn({ nodeId: node.id, attempt, error: String(error) }, 'Node retry');
            },
            controller.signal,
          ),
          timeoutMs,
          node.id,
        );

        // Store output
        ctx.nodeOutputs.set(node.id, result);

        // Transition to succeeded
        await this.store.nodeExecutions.updateStatus(nodeExecId, {
          status: 'succeeded',
          completed_at: new Date().toISOString(),
          output: result,
        });
        await recordEvent(this.store, ctx.executionId, 'node_succeeded', node.id, {
          duration_ms: Date.now() - startTime,
          // V1.4 M2 (F-2): persist the node output (size-capped) so replay can
          // reconstruct full node outputs from the event log. Oversized outputs
          // are stored as a `{__truncated__, size, preview}` marker.
          output: capOutputForEvent(result, this.eventOutputMaxBytes),
        });
        this.emit({
          type: 'node_succeeded',
          executionId: ctx.executionId,
          nodeId: node.id,
          nodeType: node.type,
          status: 'succeeded',
          timestamp: new Date().toISOString(),
          output: result,
          durationMs: Date.now() - startTime,
          ...this.parentMarker(ctx),
        });

        const duration = (Date.now() - startTime) / 1000;
        metrics.nodeDuration.observe({ node_type: node.type, workflow_id: ctx.workflowId }, duration);
      } finally {
        signal?.removeEventListener('abort', forwardAbort);
      }
    } catch (err) {
      await this.store.nodeExecutions.updateStatus(nodeExecId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: String(err),
      });
      await recordEvent(this.store, ctx.executionId, 'node_failed', node.id, { error: String(err) });
      this.emit({
        type: 'node_failed',
        executionId: ctx.executionId,
        nodeId: node.id,
        nodeType: node.type,
        status: 'failed',
        timestamp: new Date().toISOString(),
        error: String(err),
        ...this.parentMarker(ctx),
      });
      metrics.nodeErrorsTotal.inc({ node_type: node.type, error_type: 'execution_error' });
      throw err;
    }
  }

  private async dispatchNode(
    node: WorkflowNode,
    input: Record<string, unknown>,
    ctx: ExecutorContext,
    idempotencyKey?: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    // V1.2 M3 (F-Loop-1): `workflow.invoke` is an engine built-in, NOT a
    // connector — intercept it before connector routing so it recurses into a
    // child execution on the same executor (reusing timeout/events/idempotency).
    if (node.type === 'workflow.invoke') {
      return this.invokeSubWorkflow(node, input, ctx);
    }

    // V1.7 (L-4): `control.delay` is an engine built-in — actually wait (bounded
    // by the node timeout wrapping this dispatch).
    if (node.type === 'control.delay') {
      const raw = input['duration_ms'] ?? input['duration'];
      const ms = Number(raw);
      if (!Number.isFinite(ms) || ms < 0) {
        throw new LoopError('VALIDATION_INVALID', `control.delay node '${node.id}' requires a non-negative numeric duration_ms`, 400);
      }
      await DelayNode.delay(Math.floor(ms));
      return { delayed_ms: Math.floor(ms) };
    }

    // V1.7 (L-4): approval/loop/parallel are NOT executed yet — make the
    // pass-through observable instead of silently pretending the node worked.
    if (node.type === 'control.approval' || node.type === 'control.loop' || node.type === 'control.parallel') {
      logger.warn(
        { nodeId: node.id, nodeType: node.type, executionId: ctx.executionId },
        'Control node type is not implemented yet — passing through without pausing (see NEXT_STEPS)',
      );
    }

    // Determine connector type from node type (e.g. "vault.search" → "vault")
    const connectorType = node.type.split('.')[0] ?? node.type;
    const operation = node.type.split('.').slice(1).join('.') ?? 'execute';

    const adapter = this.connectors.getAdapter(connectorType);
    if (!adapter) {
      // Control nodes (e.g. "control.condition") pass through input as output.
      // Unknown connector types are logged as warnings for debuggability.
      if (!connectorType.startsWith('control')) {
        logger.warn(
          { nodeId: node.id, nodeType: node.type, connectorType },
          'No adapter registered for connector type — passing input as output',
        );
      }
      return input;
    }

    const instanceId = this.connectors.listInstances().find((id) => {
      return this.connectors.getInstanceAdapterType(id) === connectorType;
    });

    const config = instanceId ? this.connectors.getInstanceConfig(instanceId) : {};
    // Surface the instance's api_key (when present) as a secret so adapters can
    // authenticate upstream calls (INTEGRATION_CONTRACT.md §4.2). V1.7 (L-2):
    // the encrypted secrets store is consulted first (set via
    // POST /api/v1/connectors), with the instance's inline config as fallback
    // (env-registered instances legitimately carry their key inline).
    let apiKey: string | undefined;
    if (instanceId && this.secretResolver) {
      const resolved = await this.secretResolver('api_key', 'connector', instanceId);
      if (resolved !== null) apiKey = resolved;
    }
    if (apiKey === undefined && typeof config?.['api_key'] === 'string' && (config['api_key'] as string).length > 0) {
      apiKey = config['api_key'] as string;
    }
    const secrets = apiKey !== undefined ? { api_key: apiKey } : undefined;
    // V1.1 M1 (F2): forward the idempotency key so connectors can best-effort
    // propagate it upstream (e.g. an `Idempotency-Key` header). Optional — the
    // request/response contract is unchanged (INTEGRATION_CONTRACT.md §4).
    // Adapters must consult `egress` before every outbound call and forward
    // `signal` so timeouts/airgap actually stop the network work.
    const result = await adapter.execute({
      operation,
      input,
      config,
      secrets,
      idempotencyKey,
      ...(this.egressGate ? { egress: this.egressGate } : {}),
      ...(signal ? { signal } : {}),
    });
    return result.output;
  }

  /**
   * V1.7 (branch wiring): context handed to the restricted condition
   * evaluator. Supports `{{trigger.payload.*}}`, `{{variables.*}}` and
   * `{{<nodeId>.output.*}}` references against this execution's state.
   */
  private branchContext(ctx: ExecutorContext): Record<string, unknown> {
    const context: Record<string, unknown> = {
      trigger: { payload: ctx.triggerPayload },
      variables: ctx.variables,
    };
    for (const [id, output] of ctx.nodeOutputs) {
      context[id] = { output };
    }
    return context;
  }

  /**
   * V1.7 (branch wiring): on resume/idempotent skip of a completed branch
   * node, rebuild its decision from the persisted output so downstream pruning
   * still sees which port fired.
   */
  private restoreBranchDecision(node: WorkflowNode, output: Record<string, unknown> | undefined, ctx: ExecutorContext): void {
    if (node.type !== 'control.branch' || !output) return;
    const branch = output['branch'];
    if (branch === 'true' || branch === 'false') {
      ctx.branchDecisions.set(node.id, branch);
    }
  }

  /** Resolve {{variable}} references in config values. */
  private resolveVariables(config: Record<string, unknown>, ctx: ExecutorContext): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      resolved[key] = this.resolveValue(value, ctx);
    }
    return resolved;
  }

  /**
   * V1.7 (L-6): interpolate DEEP — nested objects and arrays inside node
   * configs (e.g. a generic REST `body` object) previously kept their literal
   * `{{…}}` text and were sent upstream verbatim.
   */
  private resolveValue(value: unknown, ctx: ExecutorContext): unknown {
    if (typeof value === 'string') {
      return this.interpolateString(value, ctx);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.resolveValue(item, ctx));
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.resolveValue(v, ctx);
      }
      return out;
    }
    return value;
  }

  private interpolateString(template: string, ctx: ExecutorContext): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, varPath: string) => {
      const path = varPath.trim();
      if (path.startsWith('trigger.payload.')) {
        // Traverse the dotted path segment by segment so nested payloads
        // (`trigger.payload.data.customer.id`) resolve; the previous flat
        // lookup silently emitted an empty string for any nesting.
        const key = path.slice('trigger.payload.'.length);
        const value = key
          .split('.')
          .reduce<unknown>(
            (obj, segment) =>
              obj !== null && typeof obj === 'object' ? (obj as Record<string, unknown>)[segment] : undefined,
            ctx.triggerPayload,
          );
        return value === undefined || value === null ? '' : String(value);
      }
      // V1.7 (L-6): workflow-level variables (`{{variables.name}}`) resolve to
      // the definition's declared default — previously they interpolated to an
      // empty string, silently corrupting downstream URLs/recipients.
      if (path.startsWith('variables.')) {
        const segments = path.slice('variables.'.length).split('.');
        const value = segments.reduce<unknown>(
          (obj, segment) =>
            obj !== null && typeof obj === 'object' ? (obj as Record<string, unknown>)[segment] : undefined,
          ctx.variables,
        );
        return value === undefined || value === null ? '' : String(value);
      }
      // Node outputs: look the reference up against the raw node id first
      // (works for any id shape, incl. hyphens/UUIDs), falling back to the
      // legacy `node_X` prefixed-id convention.
      const outputMatch = path.match(/^([\w-]+)\.output\.(.+)$/);
      if (outputMatch) {
        const rawId = outputMatch[1]!;
        const outputKey = outputMatch[2]!;
        const nodeOutput = ctx.nodeOutputs.get(rawId) ?? ctx.nodeOutputs.get(`node_${rawId}`);
        return String(this.resolveOutputPath(nodeOutput, outputKey) ?? '');
      }
      return '';
    });
  }

  /**
   * Resolve a (possibly dotted) output key against a node's output. A flat key
   * wins unchanged (V1.0/V1.1 behaviour); when absent, the key is traversed as
   * a nested path so sub-workflow outputs are reachable, e.g.
   * `{{node_sub.output.outputs.node_c1.value}}` (V1.2 M3, S3).
   */
  private resolveOutputPath(nodeOutput: Record<string, unknown> | undefined, outputKey: string): unknown {
    if (nodeOutput === undefined) return undefined;
    if (outputKey in nodeOutput) return nodeOutput[outputKey];
    let current: unknown = nodeOutput;
    for (const segment of outputKey.split('.')) {
      if (current === null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  private async completeExecution(
    executionId: string,
    status: 'succeeded' | 'failed',
    startTime: number,
    error?: string,
    workflowId?: string,
    parentExecutionId?: string,
  ): Promise<void> {
    const duration = Date.now() - startTime;
    // Guarded transition: never overwrite a terminal status. Without the guard
    // an executor completion raced (and reverted) an API-initiated cancel.
    const applied = await this.store.executions.completeIfActive(executionId, {
      status,
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      ...(error !== undefined ? { error } : {}),
    });
    let finalStatus: ExecutionStatus = status;
    if (!applied) {
      const current = await this.store.executions.getById(executionId);
      if (current) finalStatus = current.status;
    }
    metrics.executionsTotal.inc({ workflow_id: workflowId ?? 'unknown', status: finalStatus });
    metrics.executionDuration.observe({ workflow_id: workflowId ?? 'unknown' }, duration / 1000);
    // V1.1 M2 (F5): real-time terminal status for live monitors.
    this.emit({
      type: finalStatus === 'succeeded' ? 'execution_succeeded' : 'execution_failed',
      executionId,
      status: finalStatus,
      timestamp: new Date().toISOString(),
      durationMs: duration,
      ...(error !== undefined ? { error } : {}),
      ...(parentExecutionId !== undefined ? { parentExecutionId } : {}),
    });
  }

  /**
   * V1.2 M3 (F-Loop-1): execute a `workflow.invoke` node. Resolves the child
   * definition (inline `input.definition` object, or load by `input.workflow_id`),
   * maps `input.inputs` onto the child's `trigger.payload`, and recursively runs
   * the child on the SAME executor — so the child reuses the workflow timeout,
   * EventBus fan-out, idempotency and resume machinery. Returns
   * `{ outputs, status: 'succeeded' }` (the child's final per-node outputs) so
   * downstream parent nodes can reference them; a failing child throws, failing
   * this parent node. Recursion is bounded by `maxSubWorkflowDepth` plus a
   * visited-set cycle guard.
   */
  private async invokeSubWorkflow(
    node: WorkflowNode,
    input: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<Record<string, unknown>> {
    const childDepth = ctx.depth + 1;
    if (childDepth > this.maxSubWorkflowDepth) {
      throw new LoopError(
        'SUBWORKFLOW_DEPTH_EXCEEDED',
        `Sub-workflow recursion depth ${childDepth} exceeds the maximum of ${this.maxSubWorkflowDepth} (node '${node.id}')`,
        400,
        { node_id: node.id, depth: childDepth, max_depth: this.maxSubWorkflowDepth },
      );
    }

    // Resolve the child definition: an inline object wins, else load by id.
    const inline = input['definition'];
    const workflowIdInput = input['workflow_id'];
    let childDefinition: WorkflowDefinition;
    let childWorkflowId: string | undefined;
    let childVersion: number = 1;

    if (inline !== undefined && inline !== null && typeof inline === 'object' && !Array.isArray(inline)) {
      const candidate = inline as WorkflowDefinition;
      // Stored definitions pass authoring validation on save; an inline
      // definition bypasses that path entirely, so run a structural check
      // here — otherwise a malformed/cyclic inline graph is silently
      // "partially executed and successful" (computeLevels drops cycle nodes).
      validateInlineDefinition(candidate, node.id);
      childDefinition = candidate;
    } else if (typeof workflowIdInput === 'string' && workflowIdInput.length > 0) {
      const loaded = await this.store.workflows.getById(workflowIdInput);
      if (!loaded) {
        throw new LoopError('NOT_FOUND_WORKFLOW', `Sub-workflow '${workflowIdInput}' not found (node '${node.id}')`, 404);
      }
      childDefinition = loaded.definition;
      childWorkflowId = loaded.id;
      childVersion = loaded.version;
    } else {
      throw new LoopError(
        'VALIDATION_REQUIRED',
        `workflow.invoke node '${node.id}' requires an inline 'definition' object or a 'workflow_id'`,
        400,
      );
    }

    // Cycle guard: a definition already on the invocation stack means an
    // infinite loop — fail fast instead of recursing to the depth ceiling.
    const key = subWorkflowKey(childDefinition, childWorkflowId);
    if (ctx.visited.has(key)) {
      throw new LoopError(
        'SUBWORKFLOW_DEPTH_EXCEEDED',
        `Sub-workflow invocation cycle detected at '${key}' (node '${node.id}')`,
        400,
        { node_id: node.id, cycle: key },
      );
    }

    // Input mapping (S3): parent node `input.inputs` → child `trigger.payload`.
    const rawInputs = input['inputs'];
    const childPayload =
      rawInputs !== undefined && rawInputs !== null && typeof rawInputs === 'object' && !Array.isArray(rawInputs)
        ? (rawInputs as Record<string, unknown>)
        : {};

    // Resolve a valid `workflow_id` FK for the child execution row. Stored
    // sub-workflows use their own id; inline definitions reuse the parent
    // execution's workflow_id so the child execution and its node/event rows
    // satisfy FK constraints without persisting a synthetic workflow.
    if (childWorkflowId === undefined) {
      const parentExecution = await this.store.executions.getById(ctx.executionId);
      if (!parentExecution) {
        throw new LoopError(
          'INTERNAL_ERROR',
          `Parent execution '${ctx.executionId}' not found for sub-workflow invocation`,
          500,
        );
      }
      childWorkflowId = parentExecution.workflow_id;
      childVersion = parentExecution.workflow_version;
    }

    // Audit #11: derive the child execution id deterministically from the
    // parent's idempotency identity so executeWithRetry retries and crash
    // resume reuse the SAME child execution — its succeeded-node skip path
    // then prevents re-firing child side effects. A fresh randomUUID() per
    // attempt gave every retry a brand-new child whose idempotency keys never
    // matched, re-dispatching every child node.
    const childExecutionId = subWorkflowExecutionId(ctx.executionId, node.id);
    const existingChild = await this.store.executions.getById(childExecutionId);
    if (!existingChild) {
      await this.store.executions.create({
        id: childExecutionId,
        workflow_id: childWorkflowId,
        // The stored workflow's current version, or (for inline definitions
        // reusing the parent's FK) the parent execution's version — a hardcoded
        // 1 resolved stale definitions during replay.
        workflow_version: childVersion,
        trigger_type: 'event',
        trigger_payload: childPayload,
      });
    }

    const visited = new Set(ctx.visited);
    visited.add(key);

    // Recurse on the same executor; a child failure propagates up and fails
    // this parent node (execute() re-throws the terminal error).
    const childOutputs = await this.execute(childExecutionId, childDefinition, childPayload, {
      depth: childDepth,
      parentExecutionId: ctx.executionId,
      visited,
    });

    // Output return (S3): expose the child's final per-node outputs.
    const outputs: Record<string, Record<string, unknown>> = {};
    for (const [nodeId, output] of childOutputs) {
      outputs[nodeId] = output;
    }
    return { outputs, status: 'succeeded' };
  }
}

/**
 * V1.2 M3: stable identity for a sub-workflow definition used by the cycle
 * guard — the stored workflow id when known, else the definition's name, else a
 * fingerprint of its node ids.
 */
/** Fixed namespace for sub-workflow execution-id derivation (audit #11). */
const SUBWORKFLOW_ID_NAMESPACE = '6ba7b814-9dad-11d1-80b4-00c04fd430c8';

/**
 * Deterministic UUIDv5 (RFC 4122, SHA-1) of `${parentExecutionId}:${nodeId}`.
 * Retries and resume of the same parent node therefore resolve to the same
 * child execution id, letting the child's idempotency/resume machinery skip
 * already-succeeded nodes instead of re-firing their side effects.
 */
function subWorkflowExecutionId(parentExecutionId: string, nodeId: string): string {
  const nsHex = SUBWORKFLOW_ID_NAMESPACE.replace(/-/g, '');
  const nsBytes = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) nsBytes[i] = Number.parseInt(nsHex.slice(i * 2, i * 2 + 2), 16);
  const digest = createHash('sha1').update(nsBytes).update(`${parentExecutionId}:${nodeId}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function subWorkflowKey(definition: WorkflowDefinition, workflowId?: string): string {
  if (workflowId !== undefined) return `id:${workflowId}`;
  const name = definition.metadata?.name;
  if (name !== undefined && name.length > 0) return `name:${name}`;
  return `nodes:${definition.nodes.map((n) => n.id).join(',')}`;
}

/**
 * Structural validation for inline sub-workflow definitions. Stored
 * definitions are validated at authoring time; inline ones arrive straight
 * from node input, so a malformed graph (missing nodes/edges, dangling edge
 * references, duplicate node ids) must fail fast instead of being silently
 * dropped level-by-level by the scheduler.
 */
function validateInlineDefinition(definition: WorkflowDefinition, nodeId: string): void {
  if (!definition || !Array.isArray(definition.nodes)) {
    throw new LoopError('VALIDATION_INVALID', `workflow.invoke node '${nodeId}': inline definition has no nodes array`, 400);
  }
  const ids = new Set<string>();
  for (const n of definition.nodes) {
    if (!n || typeof n.id !== 'string' || n.id.length === 0 || typeof n.type !== 'string' || n.type.length === 0) {
      throw new LoopError('VALIDATION_INVALID', `workflow.invoke node '${nodeId}': inline definition contains a node without a string id/type`, 400);
    }
    if (ids.has(n.id)) {
      throw new LoopError('VALIDATION_INVALID', `workflow.invoke node '${nodeId}': duplicate node id '${n.id}' in inline definition`, 400);
    }
    ids.add(n.id);
  }
  for (const e of definition.edges ?? []) {
    if (!e || !ids.has(e.source) || !ids.has(e.target)) {
      throw new LoopError('VALIDATION_INVALID', `workflow.invoke node '${nodeId}': inline definition edge references an unknown node`, 400);
    }
  }
  // Cycles: this is the only definition entry point that bypasses authoring's
  // detectCycle. computeLevels silently truncates cyclic graphs — the nodes on
  // the cycle vanish and the sub-workflow reports success with missing output.
  try {
    topologicalSort(definition.nodes, definition.edges ?? []);
  } catch {
    throw new LoopError('VALIDATION_INVALID', `workflow.invoke node '${nodeId}': inline definition contains a dependency cycle`, 400);
  }
}
