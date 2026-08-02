/**
 * Route registration — all API endpoints from TSD §5.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { SqliteStateStore } from '@loop/state';
import type { ConnectorRegistry } from '@loop/connectors';
import type { WorkflowAuthoringService } from '@loop/workflow-authoring';
import type { ExecutionExecutor } from '@loop/engine';
import { replayExecution, snapshotToJson } from '@loop/engine';
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
import { createAuthGuard, isProtectedPath, requireRole, type Role } from '../middleware/auth.js';

/** Extract the request ID attached by the requestIdHook middleware. */
function getRequestId(request: FastifyRequest): string {
  return (request as unknown as Record<string, unknown>)['requestId'] as string ?? 'unknown';
}

/**
 * The acting identity for a request (V1.3 F-RBAC-Loop): the principal plus its
 * RBAC role. `principal` prefers the authenticated identity attached by the auth
 * guard (JWT subject or API-key service account); falls back to the x-user-id
 * header (set by an upstream auth gateway), then to the 'system' service account.
 * `role` is the role resolved by the auth guard; when auth is disabled it
 * defaults to 'admin' so single-user/dev setups keep full access.
 */
interface Actor {
  principal: string;
  role: Role;
}

function getActor(request: FastifyRequest): Actor {
  const userId = request.headers['x-user-id'] as string | undefined;
  const principal = request.authPrincipal ?? userId ?? 'system';
  return { principal, role: request.authRole ?? 'admin' };
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

  // ─── JIT user provisioning ───────────────────────────────────────────────
  // created_by columns FK-reference the users table, but only the 'system'
  // account is seeded at startup. Without this, a JWT-authenticated user's
  // first write failed with a FOREIGN KEY constraint violation (found via
  // role-based UAT: admin/editor could not create workflows). Provision the
  // authenticated principal on first write so the FK is satisfied. Runs after
  // the auth guard; reads are skipped; a concurrent duplicate create is safe.
  app.addHook('onRequest', async (request) => {
    const principal = request.authPrincipal;
    if (!principal || principal === 'system') return;
    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    if (!isProtectedPath(request.url)) return;
    const existing = await deps.store.users.getById(principal);
    if (existing) return;
    const storeRole: 'read' | 'write' | 'admin' =
      request.authRole === 'admin' ? 'admin' : request.authRole === 'editor' ? 'write' : 'read';
    try {
      await deps.store.users.create({
        id: principal,
        username: principal,
        password_hash: '',
        email: `${principal}@users.loop.internal`,
        role: storeRole,
        display_name: principal,
      });
    } catch {
      // A concurrent request already provisioned this user (race) — safe to ignore.
    }
  });

  // ─── Workflows (§5.3) ───────────────────────────────────────────────────

  app.post('/api/v1/workflows', async (request, reply) => {
    const body = parseBody<CreateWorkflowRequest>(CreateWorkflowRequestSchema, request.body);
    const actor = getActor(request);
    const workflow = await deps.authoring.create({
      name: body.name,
      description: body.description,
      definition: body.definition,
      tags: body.tags,
      created_by: actor.principal,
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
    const workflow = await deps.authoring.update(id, { ...body, updated_by: actor.principal } as never);
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
    const executionId = await deps.manualHandler.trigger(id, body?.payload ?? {}, actor.principal);
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

  // ─── Replay (V1.3 M1, F-Loop-1) — event-sourced reconstruction + dry-run ──
  // GET is a read-only dry-run (viewer+): reconstructs the snapshot from the
  // execution_events log and returns per-node replay decisions WITHOUT invoking
  // any connector. POST honours ?dryRun= (default true); only ?dryRun=false
  // really re-executes via the V1.1 resume path (editor+, side effects).

  app.get('/api/v1/executions/:id/replay', async (request) => {
    const { id } = request.params as { id: string };
    const result = await replayExecution(deps.executor, deps.store, id, { dryRun: true });
    return {
      success: true,
      data: { ...result, snapshot: snapshotToJson(result.snapshot) },
      meta: meta(request),
    };
  });

  app.post('/api/v1/executions/:id/replay', async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    const dryRun = query['dryRun'] !== 'false'; // default true (read-only)
    const result = await replayExecution(deps.executor, deps.store, id, { dryRun });
    return {
      success: true,
      data: { ...result, snapshot: snapshotToJson(result.snapshot) },
      meta: meta(request),
    };
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

  // Admin-only system route (V1.3 RBAC). The centralised auth guard already
  // maps /api/v1/audit → admin; requireRole makes the guard explicit per-route.
  app.get('/api/v1/audit', { preHandler: [requireRole('admin')] }, async (request) => {
    const query = request.query as Record<string, string>;
    const result = await deps.store.audit.list(
      { actor: query['actor'], action: query['action'] },
      { page: parseInt(query['page'] ?? '1', 10), per_page: parseInt(query['per_page'] ?? '50', 10) },
    );
    return { success: true, data: result.data, meta: meta(request, { total: result.total, page: result.page, per_page: result.per_page, total_pages: result.total_pages }) };
  });
}
