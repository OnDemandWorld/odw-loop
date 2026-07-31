/**
 * Main execution executor — processes nodes in topological order (§6.1).
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@loop/observability';
import { metricsRegistry } from '@loop/observability';
import { LoopError, type WorkflowDefinition, type WorkflowNode } from '@loop/types';
import type { StateStore } from '@loop/state';
import type { ConnectorRegistry } from '@loop/connectors';
import { computeLevels } from './scheduler.js';
import { executeWithRetry } from './retry.js';
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
  ) {}

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
   */
  async execute(
    executionId: string,
    definition: WorkflowDefinition,
    triggerPayload: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<Map<string, Record<string, unknown>>> {
    const startTime = Date.now();
    const ctx: ExecutorContext = {
      executionId,
      workflowId: definition.metadata?.name ?? '',
      triggerPayload,
      nodeOutputs: new Map(),
      completedOutputs: new Map(),
      depth: options?.depth ?? 0,
      ...(options?.parentExecutionId !== undefined ? { parentExecutionId: options.parentExecutionId } : {}),
      visited: options?.visited ?? new Set<string>(),
    };

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
    const workflowTimeoutMs = definition.settings?.workflow_timeout_ms ?? this.workflowTimeoutMs;
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
        const settled = await this.executeLevel(level, ctx, definition, controller.signal);
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
    }
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
      const batch = level.slice(i, i + limit);
      const batchResults = await Promise.allSettled(
        batch.map((node) => this.executeNode(node, ctx, definition, signal)),
      );
      settled.push(...batchResults);
    }

    return settled;
  }

  /**
   * Bound a node execution with a timeout. An AbortController is aborted when
   * the deadline elapses and the returned promise rejects with a NODE_TIMEOUT
   * error, so a hung adapter cannot stall the whole execution.
   *
   * V1.1 M1 (F3): an optional parent `signal` (the workflow-level controller)
   * also aborts the node — when the whole workflow times out, every in-flight
   * node rejects with a WORKFLOW_TIMEOUT error instead of hanging.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number, nodeId: string, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
        reject(new LoopError('NODE_TIMEOUT', `Node '${nodeId}' timed out after ${ms}ms`, 500));
      }, ms);

      const onWorkflowAbort = (): void => {
        clearTimeout(timer);
        reject(new LoopError('WORKFLOW_TIMEOUT', `Node '${nodeId}' aborted by workflow timeout (workflow_timeout)`, 500));
      };

      if (signal) {
        if (signal.aborted) {
          onWorkflowAbort();
          return;
        }
        signal.addEventListener('abort', onWorkflowAbort, { once: true });
      }

      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onWorkflowAbort);
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

  private async executeNode(node: WorkflowNode, ctx: ExecutorContext, _definition: WorkflowDefinition, signal?: AbortSignal): Promise<void> {
    // V1.1 M1 (F1 resume / F2 idempotency): if this node already succeeded for
    // this execution, skip dispatch entirely and reuse its stored output — no
    // connector call, no duplicate side effects.
    const completed = ctx.completedOutputs.get(node.id);
    if (completed !== undefined) {
      ctx.nodeOutputs.set(node.id, completed);
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
      // Resolve variable interpolation
      const resolvedInput = this.resolveVariables(node.config, ctx);

      // Execute with retry, bounded by the node timeout (per-node override or
      // the executor-wide default) and the workflow-level signal.
      const retryConfig = node.retry ?? { max_attempts: 0, backoff: 'fixed' as const, initial_delay_ms: 0 };
      const timeoutMs = node.timeout_ms ?? this.nodeTimeoutMs;
      const result = await this.withTimeout(
        executeWithRetry(
          async () => this.dispatchNode(node, resolvedInput, ctx, idempotencyKey),
          retryConfig,
          (attempt, error) => {
            logger.warn({ nodeId: node.id, attempt, error: String(error) }, 'Node retry');
          },
        ),
        timeoutMs,
        node.id,
        signal,
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
  ): Promise<Record<string, unknown>> {
    // V1.2 M3 (F-Loop-1): `workflow.invoke` is an engine built-in, NOT a
    // connector — intercept it before connector routing so it recurses into a
    // child execution on the same executor (reusing timeout/events/idempotency).
    if (node.type === 'workflow.invoke') {
      return this.invokeSubWorkflow(node, input, ctx);
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
    // authenticate upstream calls (INTEGRATION_CONTRACT.md §4.2).
    const apiKey = config?.['api_key'];
    const secrets = typeof apiKey === 'string' && apiKey.length > 0 ? { api_key: apiKey } : undefined;
    // V1.1 M1 (F2): forward the idempotency key so connectors can best-effort
    // propagate it upstream (e.g. an `Idempotency-Key` header). Optional — the
    // request/response contract is unchanged (INTEGRATION_CONTRACT.md §4).
    const result = await adapter.execute({ operation, input, config, secrets, idempotencyKey });
    return result.output;
  }

  /** Resolve {{variable}} references in config values. */
  private resolveVariables(config: Record<string, unknown>, ctx: ExecutorContext): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        resolved[key] = this.interpolateString(value, ctx);
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  private interpolateString(template: string, ctx: ExecutorContext): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, varPath: string) => {
      const path = varPath.trim();
      if (path.startsWith('trigger.payload.')) {
        const key = path.replace('trigger.payload.', '');
        return String(ctx.triggerPayload[key] ?? '');
      }
      if (path.match(/^node_\w+\.output\./)) {
        const parts = path.split('.');
        const nodeId = parts[0]!.replace('node_', '');
        const outputKey = parts.slice(2).join('.');
        const nodeOutput = ctx.nodeOutputs.get(`node_${nodeId}`);
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
    await this.store.executions.updateStatus(executionId, {
      status,
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      error,
    });
    metrics.executionsTotal.inc({ workflow_id: workflowId ?? 'unknown', status });
    metrics.executionDuration.observe({ workflow_id: workflowId ?? 'unknown' }, duration / 1000);
    // V1.1 M2 (F5): real-time terminal status for live monitors.
    this.emit({
      type: status === 'succeeded' ? 'execution_succeeded' : 'execution_failed',
      executionId,
      status,
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

    if (inline !== undefined && inline !== null && typeof inline === 'object' && !Array.isArray(inline)) {
      childDefinition = inline as WorkflowDefinition;
    } else if (typeof workflowIdInput === 'string' && workflowIdInput.length > 0) {
      const loaded = await this.store.workflows.getById(workflowIdInput);
      if (!loaded) {
        throw new LoopError('NOT_FOUND_WORKFLOW', `Sub-workflow '${workflowIdInput}' not found (node '${node.id}')`, 404);
      }
      childDefinition = loaded.definition;
      childWorkflowId = loaded.id;
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
    }

    const childExecutionId = randomUUID();
    await this.store.executions.create({
      id: childExecutionId,
      workflow_id: childWorkflowId,
      workflow_version: 1,
      trigger_type: 'event',
      trigger_payload: childPayload,
    });

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
function subWorkflowKey(definition: WorkflowDefinition, workflowId?: string): string {
  if (workflowId !== undefined) return `id:${workflowId}`;
  const name = definition.metadata?.name;
  if (name !== undefined && name.length > 0) return `name:${name}`;
  return `nodes:${definition.nodes.map((n) => n.id).join(',')}`;
}
