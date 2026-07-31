/**
 * Route registration — all API endpoints from TSD §5.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { SqliteStateStore } from '@loop/state';
import type { ConnectorRegistry } from '@loop/connectors';
import type { WorkflowAuthoringService } from '@loop/workflow-authoring';
import type { ExecutionExecutor } from '@loop/engine';
import type { TriggerDispatcher, WebhookTriggerHandler, ManualTriggerHandler } from '@loop/triggers';
import type { EgressEngine } from '@loop/egress';
import type { SecretsManager } from '@loop/secrets';
import {
  CreateWorkflowRequestSchema,
  UpdateWorkflowRequestSchema,
  LoopError,
  type CreateWorkflowRequest,
  type UpdateWorkflowRequest,
} from '@loop/types';
import type { LoopConfig } from '../config.js';
import { createAuthGuard } from '../middleware/auth.js';

/** Extract the request ID attached by the requestIdHook middleware. */
function getRequestId(request: FastifyRequest): string {
  return (request as unknown as Record<string, unknown>)['requestId'] as string ?? 'unknown';
}

/**
 * Extract the acting user from the request.
 * Prefers the authenticated principal attached by the auth guard (JWT subject or
 * API-key service account); falls back to the x-user-id header (set by an upstream
 * auth gateway), then to the 'system' service account when no context is available.
 */
function getActor(request: FastifyRequest): string {
  if (request.authPrincipal) return request.authPrincipal;
  const userId = request.headers['x-user-id'] as string | undefined;
  return userId ?? 'system';
}

/** Parse a request body against a Zod schema, throwing a 400 LoopError on failure. */
function parseBody<T>(schema: { safeParse(data: unknown): { success: true; data: T } | { success: false; error: { format(): unknown } } }, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new LoopError('VALIDATION_ERROR', 'Invalid request body', 400, result.error.format());
  }
  return result.data;
}

/** Build a standard response meta block. */
function meta(request: FastifyRequest, extra?: Record<string, unknown>) {
  return { request_id: getRequestId(request), timestamp: new Date().toISOString(), ...extra };
}

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
  // ─── Auth guard (§11) — no-op unless LOOP_REQUIRE_AUTH=true ──────────────
  app.addHook('onRequest', createAuthGuard(deps.config));

  // ─── Workflows (§5.3) ───────────────────────────────────────────────────

  app.post('/api/v1/workflows', async (request, reply) => {
    const body = parseBody<CreateWorkflowRequest>(CreateWorkflowRequestSchema, request.body);
    const actor = getActor(request);
    const workflow = await deps.authoring.create({
      name: body.name,
      description: body.description,
      definition: body.definition,
      tags: body.tags,
      created_by: actor,
    });
    return reply.status(201).send({ success: true, data: workflow, meta: meta(request) });
  });

  app.get('/api/v1/workflows', async (request) => {
    const query = request.query as Record<string, string>;
    const result = await deps.authoring.list(
      { status: query['status'] as 'draft' | 'active' | 'archived' | undefined, search: query['search'], tag: query['tag'] },
      parseInt(query['page'] ?? '1', 10),
      parseInt(query['per_page'] ?? '20', 10),
    );
    return { success: true, data: result.data, meta: meta(request, { total: result.total, page: result.page, per_page: result.per_page, total_pages: result.total_pages }) };
  });

  app.get('/api/v1/workflows/:id', async (request) => {
    const { id } = request.params as { id: string };
    const workflow = await deps.authoring.getById(id);
    return { success: true, data: workflow, meta: meta(request) };
  });

  app.put('/api/v1/workflows/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = parseBody<UpdateWorkflowRequest>(UpdateWorkflowRequestSchema, request.body);
    const actor = getActor(request);
    const workflow = await deps.authoring.update(id, { ...body, updated_by: actor } as never);
    return { success: true, data: workflow, meta: meta(request) };
  });

  app.delete('/api/v1/workflows/:id', async (request) => {
    const { id } = request.params as { id: string };
    await deps.authoring.archive(id);
    return { success: true, data: { status: 'archived' }, meta: meta(request) };
  });

  app.post('/api/v1/workflows/:id/execute', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { payload?: Record<string, unknown> };
    const actor = getActor(request);
    const executionId = await deps.manualHandler.trigger(id, body?.payload ?? {}, actor);
    return reply.status(202).send({ success: true, data: { execution_id: executionId, status: 'pending' }, meta: meta(request) });
  });

  app.post('/api/v1/workflows/:id/validate', async (request) => {
    const { id } = request.params as { id: string };
    const workflow = await deps.authoring.getById(id);
    const result = await deps.authoring.validate(workflow.definition);
    return { success: true, data: result, meta: meta(request) };
  });

  // ─── Executions (§5.4) ──────────────────────────────────────────────────

  app.get('/api/v1/executions', async (request) => {
    const query = request.query as Record<string, string>;
    const result = await deps.store.executions.list(
      { workflow_id: query['workflow_id'], status: query['status'] },
      { page: parseInt(query['page'] ?? '1', 10), per_page: parseInt(query['per_page'] ?? '20', 10) },
    );
    return { success: true, data: result.data, meta: meta(request, { total: result.total, page: result.page, per_page: result.per_page, total_pages: result.total_pages }) };
  });

  app.get('/api/v1/executions/:id', async (request) => {
    const { id } = request.params as { id: string };
    const execution = await deps.store.executions.getById(id);
    const nodeExecutions = await deps.store.nodeExecutions.listByExecution(id);
    return { success: true, data: { ...execution, nodes: nodeExecutions }, meta: meta(request) };
  });

  app.post('/api/v1/executions/:id/cancel', async (request) => {
    const { id } = request.params as { id: string };
    await deps.store.executions.updateStatus(id, { status: 'cancelled' });
    return { success: true, data: { status: 'cancelled' }, meta: meta(request) };
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
    return reply.status(201).send({ success: true, data: trigger, meta: meta(request) });
  });

  app.get('/api/v1/workflows/:id/triggers', async (request) => {
    const { id: workflowId } = request.params as { id: string };
    const triggers = await deps.store.triggers.listByWorkflow(workflowId);
    return { success: true, data: triggers, meta: meta(request) };
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

  app.get('/api/v1/connectors', async (request) => {
    const connectors = await deps.store.connectors.list();
    return { success: true, data: connectors, meta: meta(request) };
  });

  // ─── System / admin endpoints ────────────────────────────────────────────

  app.get('/api/v1/audit', async (request) => {
    const query = request.query as Record<string, string>;
    const result = await deps.store.audit.list(
      { actor: query['actor'], action: query['action'] },
      { page: parseInt(query['page'] ?? '1', 10), per_page: parseInt(query['per_page'] ?? '50', 10) },
    );
    return { success: true, data: result.data, meta: meta(request, { total: result.total, page: result.page, per_page: result.per_page, total_pages: result.total_pages }) };
  });
}
