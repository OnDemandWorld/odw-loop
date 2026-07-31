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

const logger = createLogger({ name: 'loop:engine:executor', component: 'engine' });
const metrics = metricsRegistry();

export interface ExecutorContext {
  executionId: string;
  workflowId: string;
  triggerPayload: Record<string, unknown>;
  nodeOutputs: Map<string, Record<string, unknown>>;
}

export class ExecutionExecutor {
  constructor(
    private store: StateStore,
    private connectors: ConnectorRegistry,
    private maxConcurrent = 50,
    private nodeTimeoutMs = 30_000,
  ) {}

  /** Execute a workflow from start to finish. */
  async execute(executionId: string, definition: WorkflowDefinition, triggerPayload: Record<string, unknown>): Promise<void> {
    const startTime = Date.now();
    const ctx: ExecutorContext = {
      executionId,
      workflowId: definition.metadata?.name ?? '',
      triggerPayload,
      nodeOutputs: new Map(),
    };

    // Transition execution to running
    await this.store.executions.updateStatus(executionId, {
      status: 'running',
      started_at: new Date().toISOString(),
    });
    metrics.activeExecutions.inc();

    try {
      // Group nodes into topological levels; nodes within a level have no
      // inter-dependencies and run in parallel (§6.2). Levels run sequentially
      // so downstream nodes observe upstream outputs.
      const levels = computeLevels(definition.nodes, definition.edges);

      if (levels.length === 0) {
        // Empty workflow succeeds immediately
        await this.completeExecution(executionId, 'succeeded', startTime, undefined, ctx.workflowId);
        return;
      }

      for (const level of levels) {
        const settled = await this.executeLevel(level, ctx, definition);
        // Abort the execution on the first node failure in this level; later
        // levels must not run (mirrors the previous fail-fast semantics).
        const failure = settled.find((r) => r.status === 'rejected');
        if (failure) {
          throw (failure as PromiseRejectedResult).reason;
        }
      }

      await this.completeExecution(executionId, 'succeeded', startTime, undefined, ctx.workflowId);
    } catch (err) {
      logger.error({ executionId, error: String(err) }, 'Execution failed');
      await this.completeExecution(executionId, 'failed', startTime, String(err), ctx.workflowId);
      throw err;
    } finally {
      metrics.activeExecutions.dec();
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
  ): Promise<PromiseSettledResult<void>[]> {
    const limit = Math.max(1, this.maxConcurrent);
    const settled: PromiseSettledResult<void>[] = [];

    for (let i = 0; i < level.length; i += limit) {
      const batch = level.slice(i, i + limit);
      const batchResults = await Promise.allSettled(
        batch.map((node) => this.executeNode(node, ctx, definition)),
      );
      settled.push(...batchResults);
    }

    return settled;
  }

  /**
   * Bound a node execution with a timeout. An AbortController is aborted when
   * the deadline elapses and the returned promise rejects with a NODE_TIMEOUT
   * error, so a hung adapter cannot stall the whole execution. (The signal is
   * created here for future cooperative-cancellation support in adapters.)
   */
  private withTimeout<T>(promise: Promise<T>, ms: number, nodeId: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
        reject(new LoopError('NODE_TIMEOUT', `Node '${nodeId}' timed out after ${ms}ms`, 500));
      }, ms);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  private async executeNode(node: WorkflowNode, ctx: ExecutorContext, _definition: WorkflowDefinition): Promise<void> {
    const nodeExecId = randomUUID();
    const startTime = Date.now();

    // Create node execution record
    await this.store.nodeExecutions.create({
      id: nodeExecId,
      execution_id: ctx.executionId,
      node_id: node.id,
      node_type: node.type,
      input: node.config,
    });

    // Transition to running
    await this.store.nodeExecutions.updateStatus(nodeExecId, {
      status: 'running',
      started_at: new Date().toISOString(),
    });

    try {
      // Resolve variable interpolation
      const resolvedInput = this.resolveVariables(node.config, ctx);

      // Execute with retry, bounded by the node timeout (per-node override or
      // the executor-wide default).
      const retryConfig = node.retry ?? { max_attempts: 0, backoff: 'fixed' as const, initial_delay_ms: 0 };
      const timeoutMs = node.timeout_ms ?? this.nodeTimeoutMs;
      const result = await this.withTimeout(
        executeWithRetry(
          async () => this.dispatchNode(node, resolvedInput),
          retryConfig,
          (attempt, error) => {
            logger.warn({ nodeId: node.id, attempt, error: String(error) }, 'Node retry');
          },
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

      const duration = (Date.now() - startTime) / 1000;
      metrics.nodeDuration.observe({ node_type: node.type, workflow_id: ctx.workflowId }, duration);
    } catch (err) {
      await this.store.nodeExecutions.updateStatus(nodeExecId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: String(err),
      });
      metrics.nodeErrorsTotal.inc({ node_type: node.type, error_type: 'execution_error' });
      throw err;
    }
  }

  private async dispatchNode(node: WorkflowNode, input: Record<string, unknown>): Promise<Record<string, unknown>> {
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
    const result = await adapter.execute({ operation, input, config, secrets });
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
        return String(nodeOutput?.[outputKey] ?? '');
      }
      return '';
    });
  }

  private async completeExecution(executionId: string, status: 'succeeded' | 'failed', startTime: number, error?: string, workflowId?: string): Promise<void> {
    const duration = Date.now() - startTime;
    await this.store.executions.updateStatus(executionId, {
      status,
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      error,
    });
    metrics.executionsTotal.inc({ workflow_id: workflowId ?? 'unknown', status });
    metrics.executionDuration.observe({ workflow_id: workflowId ?? 'unknown' }, duration / 1000);
  }
}
