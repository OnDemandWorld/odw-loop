/**
 * Route registration — all API endpoints from TSD §5.
 */

import type { FastifyInstance } from 'fastify';
import type { SqliteStateStore } from '@loop/state';
import type { ConnectorRegistry } from '@loop/connectors';
import type { WorkflowAuthoringService } from '@loop/workflow-authoring';
import type { ExecutionExecutor } from '@loop/engine';
import type { TriggerDispatcher, WebhookTriggerHandler, ManualTriggerHandler } from '@loop/triggers';
import type { EgressEngine } from '@loop/egress';
import type { SecretsManager } from '@loop/secrets';
import type { LoopConfig } from '../config.js';

export interface RouteDeps {
  store: SqliteStateStore;
  connectors: ConnectorRegistry;
  authoring: WorkflowAuthoringService;
  executor: ExecutionExecutor;
  triggerDispatcher: TriggerDispatcher;
  webhookHandler: WebhookTriggerHandler;
  manualHandler: ManualTriggerHandler;
  egressEngine: EgressEngine;
  secretsManager: SecretsManager;
  config: LoopConfig;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  // ─── Workflows (§5.3) ───────────────────────────────────────────────────

  app.post('/api/v1/workflows', async (request, reply) => {
    const body = request.body as { name: string; description?: string; definition: unknown; tags?: string[] };
    const workflow = await deps.authoring.create({
      name: body.name,
      description: body.description,
      definition: body.definition as never,
      tags: body.tags,
      created_by: 'system', // TODO: extract from auth context
    });
    return reply.status(201).send({ success: true, data: workflow, meta: { request_id: 'todo', timestamp: new Date().toISOString() } });
  });

  app.get('/api/v1/workflows', async (request) => {
    const query = request.query as Record<string, string>;
    const result = await deps.authoring.list(
      { status: query['status'] as 'draft' | 'active' | 'archived' | undefined, search: query['search'], tag: query['tag'] },
      parseInt(query['page'] ?? '1', 10),
      parseInt(query['per_page'] ?? '20', 10),
    );
    return { success: true, data: result.data, meta: { total: result.total, page: result.page, per_page: result.per_page, total_pages: result.total_pages, request_id: 'todo', timestamp: new Date().toISOString() } };
  });

  app.get('/api/v1/workflows/:id', async (request) => {
    const { id } = request.params as { id: string };
    const workflow = await deps.authoring.getById(id);
    return { success: true, data: workflow, meta: { request_id: 'todo', timestamp: new Date().toISOString() } };
  });

  app.put('/api/v1/workflows/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const workflow = await deps.authoring.update(id, { ...body, updated_by: 'system' } as never);
    return { success: true, data: workflow, meta: { request_id: 'todo', timestamp: new Date().toISOString() } };
  });

  app.delete('/api/v1/workflows/:id', async (request) => {
    const { id } = request.params as { id: string };
    await deps.authoring.archive(id);
    return { success: true, data: { status: 'archived' }, meta: { request_id: 'todo', timestamp: new Date().toISOString() } };
  });

  app.post('/api/v1/workflows/:id/execute', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { payload?: Record<string, unknown> };
    const executionId = await deps.manualHandler.trigger(id, body?.payload ?? {}, 'system');
    return reply.status(202).send({ success: true, data: { execution_id: executionId, status: 'pending' }, meta: { request_id: 'todo', timestamp: new Date().toISOString() } });
  });

  app.post('/api/v1/workflows/:id/validate', async (request) => {
    const { id } = request.params as { id: string };
    const workflow = await deps.authoring.getById(id);
    const result = await deps.authoring.validate(workflow.definition);
    return { success: true, data: result, meta: { request_id: 'todo', timestamp: new Date().toISOString() } };
  });

  // ─── Executions (§5.4) ──────────────────────────────────────────────────

  app.get('/api/v1/executions', async (request) => {
    const query = request.query as Record<string, string>;
    const result = await deps.store.executions.list(
      { workflow_id: query['workflow_id'], status: query['status'] },
      { page: parseInt(query['page'] ?? '1', 10), per_page: parseInt(query['per_page'] ?? '20', 10) },
    );
    return { success: true, data: result.data, meta: { total: result.total, page: result.page, per_page: result.per_page, total_pages: result.total_pages, request_id: 'todo', timestamp: new Date().toISOString() } };
  });

  app.get('/api/v1/executions/:id', async (request) => {
    const { id } = request.params as { id: string };
    const execution = await deps.store.executions.getById(id);
    const nodeExecutions = await deps.store.nodeExecutions.listByExecution(id);
    return { success: true, data: { ...execution, nodes: nodeExecutions }, meta: { request_id: 'todo', timestamp: new Date().toISOString() } };
  });

  app.post('/api/v1/executions/:id/cancel', async (request) => {
    const { id } = request.params as { id: string };
    await deps.store.executions.updateStatus(id, { status: 'cancelled' });
    return { success: true, data: { status: 'cancelled' }, meta: { request_id: 'todo', timestamp: new Date().toISOString() } };
  });

  // ─── Triggers (§5.5) ────────────────────────────────────────────────────

  app.post('/api/v1/workflows/:id/triggers', async (request, reply) => {
    const { id: workflowId } = request.params as { id: string };
    const body = request.body as { trigger_type: string; config: Record<string, unknown> };
    const trigger = await deps.store.triggers.create({
      id: crypto.randomUUID(),
      workflow_id: workflowId,
      trigger_type: body.trigger_type as 'cron',
      config: body.config,
    });
    return reply.status(201).send({ success: true, data: trigger, meta: { request_id: 'todo', timestamp: new Date().toISOString() } });
  });

  app.get('/api/v1/workflows/:id/triggers', async (request) => {
    const { id: workflowId } = request.params as { id: string };
    const triggers = await deps.store.triggers.listByWorkflow(workflowId);
    return { success: true, data: triggers, meta: { request_id: 'todo', timestamp: new Date().toISOString() } };
  });

  // ─── Webhooks (§5.7) ────────────────────────────────────────────────────

  app.post('/webhooks/:triggerId', async (request, reply) => {
    const { triggerId } = request.params as { triggerId: string };
    const result = await deps.webhookHandler.handle({
      triggerId,
      signature: request.headers['x-loop-signature'] as string | null,
      body: request.body,
      rawBody: JSON.stringify(request.body),
    });
    return reply.status(200).send({ accepted: true, execution_id: result.execution_id });
  });

  // ─── Connectors (§5.6) ──────────────────────────────────────────────────

  app.get('/api/v1/connectors', async () => {
    const connectors = await deps.store.connectors.list();
    return { success: true, data: connectors, meta: { request_id: 'todo', timestamp: new Date().toISOString() } };
  });

  // ─── System / admin endpoints ────────────────────────────────────────────

  app.get('/api/v1/audit', async (request) => {
    const query = request.query as Record<string, string>;
    const result = await deps.store.audit.list(
      { actor: query['actor'], action: query['action'] },
      { page: parseInt(query['page'] ?? '1', 10), per_page: parseInt(query['per_page'] ?? '50', 10) },
    );
    return { success: true, data: result.data, meta: { total: result.total, page: result.page, per_page: result.per_page, total_pages: result.total_pages, request_id: 'todo', timestamp: new Date().toISOString() } };
  });
}
