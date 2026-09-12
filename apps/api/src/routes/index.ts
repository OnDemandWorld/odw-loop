/**
 * Route registration — all API endpoints from TSD §5.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { StateStore } from '@loop/state';
import type { ConnectorRegistry } from '@loop/connectors';
import type { WorkflowAuthoringService } from '@loop/workflow-authoring';
import type { ExecutionExecutor } from '@loop/engine';
import { replayExecution, snapshotToJson } from '@loop/engine';
import type { TriggerDispatcher, WebhookTriggerHandler, ManualTriggerHandler, CronTriggerHandler } from '@loop/triggers';
import type { EgressEngine } from '@loop/egress';
import type { SecretsManager } from '@loop/secrets';
import type { LLMRouter, ChatMessage } from '@loop/llm';
import { z } from 'zod';
import {
  CreateWorkflowRequestSchema,
  UpdateWorkflowRequestSchema,
  LoopError,
  NotFoundError,
  ValidationError,
  type CreateWorkflowRequest,
  type UpdateWorkflowRequest,
  type WorkflowDefinition,
} from '@loop/types';
import {
  TemplateRegistry,
  INDUSTRIES,
  CATEGORIES,
  type TemplateFilters,
} from '@loop/templates';
import type { LoopConfig } from '../config.js';
import { createAuthGuard, isProtectedPath, requireRole, type Role } from '../middleware/auth.js';

/** Extract the request ID attached by the requestIdHook middleware. */
function getRequestId(request: FastifyRequest): string {
  return (request as unknown as Record<string, unknown>)['requestId'] as string ?? 'unknown';
}

/**
 * The acting identity for a request (V1.3 F-RBAC-Loop): the principal plus its
 * RBAC role. `principal` prefers the authenticated identity attached by the
 * auth guard (JWT subject or API-key service account) and otherwise falls back
 * to the 'system' service account. The `x-user-id` header was removed as a
 * fallback: with auth disabled any caller could forge audit attribution with a
 * single header, and with auth enabled the guard already sets a principal.
 */
interface Actor {
  principal: string;
  role: Role;
}

function getActor(request: FastifyRequest): Actor {
  return { principal: request.authPrincipal ?? 'system', role: request.authRole ?? 'admin' };
}

/** Parse a request body against a Zod schema, throwing a 400 LoopError on failure. */
function parseBody<T>(schema: { safeParse(data: unknown): { success: true; data: T } | { success: false; error: { format(): unknown } } }, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new LoopError('VALIDATION_ERROR', 'Invalid request body', 400, result.error.format());
  }
  return result.data;
}

/** Clamp a query-string integer into [min, max], falling back to `def`. */
function clampInt(raw: string | undefined, min: number, max: number, def: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Parse + validate pagination query params (previously `?page=abc` → 500). */
function parsePagination(query: Record<string, string>, defaultPerPage = 20): { page: number; per_page: number } {
  return {
    page: clampInt(query['page'], 1, 1_000_000_000, 1),
    per_page: clampInt(query['per_page'], 1, 200, defaultPerPage),
  };
}

/** Build a standard response meta block. */
function meta(request: FastifyRequest, extra?: Record<string, unknown>) {
  return { request_id: getRequestId(request), timestamp: new Date().toISOString(), ...extra };
}

/** POST /api/v1/templates/:id/instantiate body — both fields optional overrides. */
const InstantiateTemplateRequestSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).optional(),
});
type InstantiateTemplateRequest = z.infer<typeof InstantiateTemplateRequestSchema>;

/** POST /api/v1/workflows/:id/triggers body — validated (previously raw cast). */
const CreateTriggerRequestSchema = z.object({
  trigger_type: z.enum(['cron', 'webhook', 'event', 'manual']),
  config: z.record(z.unknown()).default({}),
});

export interface RouteDeps {
  store: StateStore;
  connectors: ConnectorRegistry;
  authoring: WorkflowAuthoringService;
  executor: ExecutionExecutor;
  triggerDispatcher: TriggerDispatcher;
  /** Needed to schedule/unregister cron triggers created at runtime (M4). */
  cronHandler: CronTriggerHandler;
  webhookHandler: WebhookTriggerHandler;
  manualHandler: ManualTriggerHandler;
  egressEngine: EgressEngine;
  secretsManager: SecretsManager;
  /** Multi-vendor LLM router — backs the llm.complete node and the LLM API. */
  llmRouter: LLMRouter;
  /** Template marketplace registry (loads templates/*.json once at startup). */
  templates: TemplateRegistry;
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

  // Fail-fast node-type validation: every node's connector prefix must be a
  // registered adapter or a deliberate pass-through prefix (stub/control).
  // The executor passes unknown connectors through as silent no-ops, so without
  // this a typo'd node type (e.g. `vaultt.search`) produced a green execution
  // that did nothing (found by QA round 1, case L-F07).
  const assertKnownNodeTypes = (definition: WorkflowDefinition): void => {
    const passThrough = new Set(['stub', 'control']);
    for (const node of definition?.nodes ?? []) {
      const connectorType = String(node.type).split('.')[0] ?? node.type;
      if (passThrough.has(connectorType)) continue;
      if (!deps.connectors.getAdapter(connectorType)) {
        throw new ValidationError(
          `Unknown node type '${node.type}' — no connector '${connectorType}' registered`,
        );
      }
    }
  };

  app.post('/api/v1/workflows', async (request, reply) => {
    const body = parseBody<CreateWorkflowRequest>(CreateWorkflowRequestSchema, request.body);
    const actor = getActor(request);
    assertKnownNodeTypes(body.definition);
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
    const pagination = parsePagination(query);
    const result = await deps.authoring.list(
      { status: query['status'] as 'draft' | 'active' | 'archived' | undefined, search: query['search'], tag: query['tag'] },
      pagination.page,
      pagination.per_page,
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
    // The manual trigger only persists a *pending* execution record; actually
    // run the workflow asynchronously. The executor transitions the execution
    // pending -> running -> succeeded/failed and the client polls
    // GET /executions/:id for status. (Found via cross-product integration
    // testing: executions previously stayed 'pending' forever because nothing
    // ever invoked the executor, so workflow nodes — incl. the Vault/Desk
    // connectors — never ran.)
    const payload = body?.payload ?? {};
    void (async () => {
      try {
        const workflow = await deps.authoring.getById(id);
        await deps.executor.execute(executionId, workflow.definition, payload);
      } catch (err) {
        // Guarded transition — a user-cancelled execution is not overwritten.
        await deps.store.executions
          .completeIfActive(executionId, {
            status: 'failed',
            completed_at: new Date().toISOString(),
            error: String(err),
          })
          .catch(() => {});
      }
    })();
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
    const pagination = parsePagination(query);
    const result = await deps.store.executions.list(
      { workflow_id: query['workflow_id'], status: query['status'] },
      { page: pagination.page, per_page: pagination.per_page },
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
    // Guarded transition (M3): only a pending/running execution can be
    // cancelled, and the executor's completion write observes the same guard —
    // previously an unconditional update could flip succeeded → cancelled (and
    // the executor would later flip it back), leaving the state machine lying.
    const applied = await deps.store.executions.completeIfActive(id, {
      status: 'cancelled',
      completed_at: new Date().toISOString(),
    });
    const execution = await deps.store.executions.getById(id);
    if (!execution) throw new NotFoundError('execution', id);
    return {
      success: applied,
      data: { status: execution.status, ...(applied ? {} : { reason: 'Execution is not active (status: ' + execution.status + ')' }) },
      meta: meta(request),
    };
  });

  // ─── Replay (V1.3 M1, F-Loop-1) — event-sourced reconstruction + dry-run ──
  // GET is a read-only dry-run (viewer+): reconstructs the snapshot from the
  // execution_events log and returns per-node replay decisions WITHOUT invoking
  // any connector. POST honours ?dryRun= (default true); only ?dryRun=false
  // really re-executes via the V1.1 resume path (editor+, side effects).

  // In-flight replay guard (L9): two concurrent replays of the same execution
  // would both slip through the resume idempotency window and double-fire
  // connector side effects.
  const replaysInFlight = new Set<string>();

  app.get('/api/v1/executions/:id/replay', async (request) => {
    const { id } = request.params as { id: string };
    const result = await replayExecution(deps.executor, deps.store, id, { dryRun: true });
    return {
      success: true,
      data: { ...result, snapshot: snapshotToJson(result.snapshot) },
      meta: meta(request),
    };
  });

  app.post('/api/v1/executions/:id/replay', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (replaysInFlight.has(id)) {
      throw new LoopError('REPLAY_IN_PROGRESS', `A replay of execution '${id}' is already in progress`, 409);
    }
    replaysInFlight.add(id);
    try {
      const query = request.query as Record<string, string>;
      const dryRun = query['dryRun'] !== 'false'; // default true (read-only)
      const result = await replayExecution(deps.executor, deps.store, id, { dryRun });
      return {
        success: true,
        data: { ...result, snapshot: snapshotToJson(result.snapshot) },
        meta: meta(request),
      };
    } finally {
      replaysInFlight.delete(id);
    }
  });

  // ─── Triggers (§5.5) ────────────────────────────────────────────────────

  app.post('/api/v1/workflows/:id/triggers', async (request, reply) => {
    const { id: workflowId } = request.params as { id: string };
    // Validate before touching the DB — the previous raw cast turned a bad
    // trigger_type / missing config into a 500 (FK/CHECK violations).
    const body = parseBody(CreateTriggerRequestSchema, request.body);
    const workflow = await deps.authoring.getById(workflowId);
    if (!workflow) throw new NotFoundError('workflow', workflowId);

    if (body.trigger_type === 'cron') {
      const expression = body.config['expression'];
      if (typeof expression !== 'string' || expression.length === 0) {
        throw new LoopError('VALIDATION_REQUIRED', "cron triggers require config.expression (e.g. '*/5 * * * *')", 400);
      }
    }
    if (body.trigger_type === 'event') {
      if (typeof body.config['source'] !== 'string' || typeof body.config['event_type'] !== 'string') {
        throw new LoopError('VALIDATION_REQUIRED', 'event triggers require config.source and config.event_type', 400);
      }
    }

    const trigger = await deps.store.triggers.create({
      id: crypto.randomUUID(),
      workflow_id: workflowId,
      trigger_type: body.trigger_type,
      config: body.config,
    });

    // Register cron triggers immediately — previously they only took effect
    // after a server restart (M4). A rejected expression rolls the create back.
    if (body.trigger_type === 'cron') {
      try {
        deps.cronHandler.register(trigger.id, workflowId, trigger.config as { expression: string; timezone?: string });
      } catch (err) {
        await deps.store.triggers.delete(trigger.id);
        const detail = err instanceof Error ? err.message : String(err);
        throw new LoopError('VALIDATION_INVALID', `Invalid cron expression: ${detail}`, 400);
      }
    }

    return reply.status(201).send({ success: true, data: trigger, meta: meta(request) });
  });

  app.delete('/api/v1/triggers/:triggerId', async (request) => {
    const { triggerId } = request.params as { triggerId: string };
    const trigger = await deps.store.triggers.getById(triggerId);
    if (!trigger) throw new NotFoundError('trigger', triggerId);
    deps.cronHandler.unregister(triggerId);
    await deps.store.triggers.delete(triggerId);
    return { success: true, data: { id: triggerId, deleted: true }, meta: meta(request) };
  });

  app.get('/api/v1/workflows/:id/triggers', async (request) => {
    const { id: workflowId } = request.params as { id: string };
    const triggers = await deps.store.triggers.listByWorkflow(workflowId);
    return { success: true, data: triggers, meta: meta(request) };
  });

  // ─── Webhooks (§5.7) ────────────────────────────────────────────────────

  app.post('/webhooks/:triggerId', async (request, reply) => {
    const { triggerId } = request.params as { triggerId: string };
    // Verify against the exact bytes received (captured by the JSON content
    // type parser); fall back to re-serialisation for injected test requests.
    const raw = (request.raw as { rawBody?: Buffer }).rawBody;
    const result = await deps.webhookHandler.handle({
      triggerId,
      signature: request.headers['x-loop-signature'] as string | null,
      body: request.body,
      rawBody: raw ? raw.toString('utf8') : JSON.stringify(request.body),
    });
    // The handler only persists a *pending* execution record — actually run
    // the workflow asynchronously, mirroring the manual /execute route.
    // Without this dispatch webhook executions stayed pending forever (bug 13).
    const payload = (request.body ?? {}) as Record<string, unknown>;
    void (async () => {
      try {
        const workflow = await deps.authoring.getById(result.workflow_id);
        await deps.executor.execute(result.execution_id, workflow.definition, payload);
      } catch (err) {
        // Guarded transition — never overwrite a terminal/cancelled status.
        await deps.store.executions
          .completeIfActive(result.execution_id, {
            status: 'failed',
            completed_at: new Date().toISOString(),
            error: String(err),
          })
          .catch(() => {});
      }
    })();
    return reply.status(200).send({ accepted: true, execution_id: result.execution_id });
  });

  // ─── Connectors (§5.6) ──────────────────────────────────────────────────

  app.get('/api/v1/connectors', async (request) => {
    const connectors = await deps.store.connectors.list();
    return { success: true, data: connectors, meta: meta(request) };
  });

  // ─── LLM (AI 能力：多厂商路由 + llm.complete 节点共用同一路由) ──────────
  // GET providers → 哪些厂商已配置、各自默认模型、熔断状态（给前端/运维看）。
  // POST complete → 单次对话补全；也等价于工作流里 llm.complete 节点的效果。

  const LlmMessageSchema = z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().min(1).max(200_000),
  });
  const LlmCompleteRequestSchema = z
    .object({
      prompt: z.string().min(1).max(200_000).optional(),
      system: z.string().max(200_000).optional(),
      messages: z.array(LlmMessageSchema).min(1).max(100).optional(),
      provider: z.string().trim().min(1).max(50).optional(),
      model: z.string().trim().min(1).max(200).optional(),
      temperature: z.number().min(0).max(2).optional(),
      max_tokens: z.number().int().min(1).max(200_000).optional(),
    })
    .refine((v) => v.prompt !== undefined || v.messages !== undefined, {
      message: "either 'prompt' or 'messages' is required",
    });

  app.get('/api/v1/llm/providers', async (request) => {
    return {
      success: true,
      data: deps.llmRouter.listProviders(),
      meta: meta(request),
    };
  });

  app.post('/api/v1/llm/complete', async (request) => {
    const body = parseBody<z.infer<typeof LlmCompleteRequestSchema>>(LlmCompleteRequestSchema, request.body);
    const messages: ChatMessage[] = body.messages ?? [
      ...(body.system ? [{ role: 'system' as const, content: body.system }] : []),
      { role: 'user' as const, content: body.prompt! },
    ];
    // Forced provider first, then every other configured vendor as fallback.
    const chain = body.provider
      ? [body.provider, ...deps.llmRouter.listProviders().map((p) => p.name).filter((n) => n !== body.provider)]
      : undefined;
    const result = await deps.llmRouter.complete(
      {
        model: body.model ?? '',
        messages,
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
      },
      chain,
    );
    return {
      success: true,
      data: {
        content: result.content,
        model: result.model,
        usage: result.usage,
        finish_reason: result.finish_reason,
      },
      meta: meta(request),
    };
  });

  // ─── Secrets (M11 — the encrypted store previously had no API surface) ──  // Admin-only. Values are encrypted at rest with LOOP_ENCRYPTION_KEY and are
  // never listed — only metadata (name/scope) comes back on GET.

  const CreateSecretRequestSchema = z.object({
    name: z.string().trim().min(1).max(200),
    value: z.string().min(1).max(65_536),
    scope: z.enum(['global', 'workflow', 'connector']).default('global'),
    scope_id: z.string().trim().max(200).optional(),
  });

  app.post('/api/v1/secrets', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const body = parseBody(CreateSecretRequestSchema, request.body);
    const actor = getActor(request);
    try {
      const result = await deps.secretsManager.set({
        name: body.name,
        value: body.value,
        scope: body.scope,
        ...(body.scope_id !== undefined ? { scope_id: body.scope_id } : {}),
        created_by: actor.principal,
      });
      return reply.status(201).send({ success: true, data: result, meta: meta(request) });
    } catch (err) {
      // Names are globally unique (schema constraint): surface a 409, not a 500.
      if (String(err).includes('UNIQUE')) {
        throw new LoopError('SECRET_CONFLICT', `A secret named '${body.name}' already exists`, 409);
      }
      throw err;
    }
  });

  app.get('/api/v1/secrets', { preHandler: [requireRole('admin')] }, async (request) => {
    const query = request.query as Record<string, string>;
    const secrets = await deps.secretsManager.list(query['scope'], query['scope_id']);
    return { success: true, data: secrets, meta: meta(request) };
  });

  app.delete('/api/v1/secrets/:id', { preHandler: [requireRole('admin')] }, async (request) => {
    const { id } = request.params as { id: string };
    await deps.secretsManager.delete(id);
    return { success: true, data: { id, deleted: true }, meta: meta(request) };
  });

  // ─── Templates / marketplace ────────────────────────────────────────────

  // Read-only gallery browse: industry/category facets, free-text search and
  // a featured-only toggle. Featured templates sort first; summaries exclude
  // the heavy definition so listing stays cheap. The facet vocabularies ride
  // along in meta so the UI renders chips from a single source of truth.
  app.get('/api/v1/templates', async (request) => {
    const query = request.query as Record<string, string>;
    const templates = deps.templates.list({
      industry: query['industry'] as TemplateFilters['industry'],
      category: query['category'] as TemplateFilters['category'],
      search: query['search'],
      featuredOnly: query['featured'] === 'true',
    });
    return {
      success: true,
      data: templates,
      meta: meta(request, { total: templates.length, industries: INDUSTRIES, categories: CATEGORIES }),
    };
  });

  // Full template (definition included) for the marketplace detail view.
  app.get('/api/v1/templates/:id', async (request) => {
    const { id } = request.params as { id: string };
    const template = deps.templates.get(id);
    if (!template) throw new NotFoundError('template', id);
    return { success: true, data: template, meta: meta(request) };
  });

  // One-click "Use template" (Zapier-style): deep-copy the template's
  // definition, apply the caller's name/description overrides and persist it
  // through the standard authoring path (validated + versioned + audited).
  // The `template:<id>` tag records provenance so the gallery can badge
  // workflows that started from a template.
  app.post('/api/v1/templates/:id/instantiate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parseBody<InstantiateTemplateRequest>(InstantiateTemplateRequestSchema, request.body ?? {});
    const actor = getActor(request);
    const template = deps.templates.instantiate(id, body);
    if (!template) throw new NotFoundError('template', id);
    assertKnownNodeTypes(template.definition);
    const workflow = await deps.authoring.create({
      name: template.name,
      description: template.description,
      definition: template.definition,
      tags: [...template.tags, `template:${id}`],
      created_by: actor.principal,
    });
    return reply.status(201).send({ success: true, data: workflow, meta: meta(request, { template_id: id }) });
  });

  // ─── System / admin endpoints ────────────────────────────────────────────

  // Admin-only system route (V1.3 RBAC). The centralised auth guard already
  // maps /api/v1/audit → admin; requireRole makes the guard explicit per-route.
  app.get('/api/v1/audit', { preHandler: [requireRole('admin')] }, async (request) => {
    const query = request.query as Record<string, string>;
    const pagination = parsePagination(query, 50);
    const result = await deps.store.audit.list(
      { actor: query['actor'], action: query['action'] },
      { page: pagination.page, per_page: pagination.per_page },
    );
    return { success: true, data: result.data, meta: meta(request, { total: result.total, page: result.page, per_page: result.per_page, total_pages: result.total_pages }) };
  });
}
