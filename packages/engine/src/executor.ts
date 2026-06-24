/**
 * Main execution executor — processes nodes in topological order (§6.1).
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@loop/observability';
import { metricsRegistry } from '@loop/observability';
import type { WorkflowDefinition, WorkflowNode } from '@loop/types';
import type { StateStore } from '@loop/state';
import type { ConnectorRegistry } from '@loop/connectors';
import { topologicalSort } from './scheduler.js';
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
      const sortedNodes = topologicalSort(definition.nodes, definition.edges);

      if (sortedNodes.length === 0) {
        // Empty workflow succeeds immediately
        await this.completeExecution(executionId, 'succeeded', startTime);
        return;
      }

      // Execute nodes in topological order
      for (const node of sortedNodes) {
        await this.executeNode(node, ctx, definition);
      }

      await this.completeExecution(executionId, 'succeeded', startTime);
    } catch (err) {
      logger.error({ executionId, error: String(err) }, 'Execution failed');
      await this.completeExecution(executionId, 'failed', startTime, String(err));
      throw err;
    } finally {
      metrics.activeExecutions.dec();
    }
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

      // Execute with retry
      const retryConfig = node.retry ?? { max_attempts: 0, backoff: 'fixed' as const, initial_delay_ms: 0 };
      const result = await executeWithRetry(
        async () => this.dispatchNode(node, resolvedInput),
        retryConfig,
        (attempt, error) => {
          logger.warn({ nodeId: node.id, attempt, error: String(error) }, 'Node retry');
        },
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
      // Control nodes or unknown types — return input as output
      return input;
    }

    const instanceId = this.connectors.listInstances().find((id) => {
      return this.connectors.getInstanceAdapterType(id) === connectorType;
    });

    const config = instanceId ? this.connectors.getInstanceConfig(instanceId) : {};
    const result = await adapter.execute({ operation, input, config });
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

  private async completeExecution(executionId: string, status: 'succeeded' | 'failed', startTime: number, error?: string): Promise<void> {
    const duration = Date.now() - startTime;
    await this.store.executions.updateStatus(executionId, {
      status,
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      error,
    });
    metrics.executionsTotal.inc({ workflow_id: '', status });
    metrics.executionDuration.observe({ workflow_id: '' }, duration / 1000);
  }
}
