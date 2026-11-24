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
import { createLogger } from '@loop/observability';
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
import type {
  TemplateRegistry} from '@loop/templates';
import {
  INDUSTRIES,
  CATEGORIES,
  type TemplateFilters,
} from '@loop/templates';

import type { LoopConfig } from '../config.js';
import { createAuthGuard, isProtectedPath, requireRole, type Role } from '../middleware/auth.js';

import { issueExecutionTicket } from './ws.js';

/** Extract the request ID attached by the requestIdHook middleware. */
function getRequestId(request: FastifyRequest): string {
  return (request as unknown as Record<string, unknown>)['requestId'] as string ?? 'unknown';
}

const logger = createLogger({ name: 'loop:api:routes', component: 'api' });

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

/**
 * Redact credential material from a connector row before it goes into a
 * response. config.api_key is a live upstream secret (Vault/Desk/Recap) —
 * it must never be readable back through the API.
 */
export function redactConnectorSecrets<T extends { config?: Record<string, unknown> }>(connector: T): T {
  const config = connector.config;
  if (!config || typeof config !== 'object') return connector;
  const redacted: Record<string, unknown> = { ...config };
  let changed = false;
  if (typeof redacted['api_key'] === 'string') {
    redacted['api_key'] = '***redacted***';
    changed = true;
  }
  // V1.7 (L-2): generic connectors carry credentials inside config.headers —
  // redact those too, not just the top-level api_key.
  const headers = redacted['headers'];
  if (headers !== null && typeof headers === 'object' && !Array.isArray(headers)) {
    const redactedHeaders: Record<string, unknown> = { ...(headers as Record<string, unknown>) };
    for (const header of ['authorization', 'x-api-key', 'cookie', 'proxy-authorization']) {
      const lower: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(redactedHeaders)) lower[k.toLowerCase()] = v;
      if (typeof lower[header] === 'string') {
        // preserve original casing when replacing
        for (const [k, v] of Object.entries(redactedHeaders)) {
          if (k.toLowerCase() === header) redactedHeaders[k] = '***redacted***';
        }
        changed = true;
      }
    }
    redacted['headers'] = redactedHeaders;
  }
  return changed ? { ...connector, config: redacted } : connector;
}

/**
 * Redact the webhook signing secret from a trigger row (GET responses only —
 * the creating POST still returns the secret once, like GitHub webhooks).
 */
export function redactTriggerSecrets<T extends { config?: Record<string, unknown> }>(trigger: T): T {
  const config = trigger.config;
  if (!config || typeof config !== 'object' || !('secret' in config)) return trigger;
  return { ...trigger, config: { ...config, secret: '***redacted***' } };
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
  /** The live gate the executor uses — API-side LLM calls must pass the same check. */
  egressGate: { check(url: string): Promise<void> };
  secretsManager: SecretsManager;
  /** Multi-vendor LLM router — backs the llm.complete node and the LLM API. */
  llmRouter: LLMRouter;
  /** Template marketplace registry (loads templates/*.json once at startup). */
  templates: TemplateRegistry;
  config: LoopConfig;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  // ─── Auth guard (§11) — no-op unless LOOP_REQUIRE_AUTH=true ──────────────
  app.addHook('onRequest', createAuthGuard(deps.config, deps.store));

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
      const adapter = deps.connectors.getAdapter(connectorType);
      if (!adapter) {
        throw new ValidationError(
          `Unknown node type '${node.type}' — no connector '${connectorType}' registered`,
        );
      }
      // Capability-level check (advisory, non-fatal): the connector exists but
      // doesn't declare this operation. Today several marketplace templates
      // reference operations the real adapters haven't implemented yet
      // (e.g. `desk.create_task`); hard-failing would break instantiation, so
      // we warn and let it surface at execution time. See NEXT_STEPS.md §1.
      const declared = adapter.getCapabilities().node_types ?? [];
      if (declared.length > 0 && !declared.includes(node.type)) {
        logger.warn(
          { nodeType: node.type, declared },
          `Node type '${node.type}' is not declared by connector '${connectorType}' — it will fail at execution`,
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
    // Same node-type guard as create (A5) — without it, PUT could introduce a
    // typo'd node type that then "green no-ops" at execution time.
    if (body.definition) assertKnownNodeTypes(body.definition);
    const workflow = await deps.authoring.update(id, { ...body, updated_by: actor.principal } as never);
    return { success: true, data: workflow, meta: meta(request) };
  });

  app.delete('/api/v1/workflows/:id', async (request) => {
    const { id } = request.params as { id: string };
    await deps.authoring.archive(id);
    // Disarm the workflow's triggers: without this, an already-registered
    // cron schedule kept firing (executing the archived definition) and
    // webhooks kept triggering — real side effects for a "deleted" flow.
    try {
      const triggers = await deps.store.triggers.listByWorkflow(id);
      for (const trigger of triggers) {
        if (trigger.enabled) {
          await deps.store.triggers.update(trigger.id, { enabled: false });
        }
        if (trigger.trigger_type === 'cron') {
          deps.cronHandler.unregister(trigger.id);
        }
      }
    } catch (err) {
      request.log.warn({ workflowId: id, error: String(err) }, 'Failed to disarm triggers of archived workflow');
    }
    return { success: true, data: { status: 'archived' }, meta: meta(request) };
  });

  app.post('/api/v1/workflows/:id/execute', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { payload?: Record<string, unknown> };
    const actor = getActor(request);
    // Audit #93: archived workflows must not run — mirror the cron/webhook
    // fire-time guards (DELETE archives and disarms; execution defeats that).
    const target = await deps.authoring.getById(id);
    if (!target) throw new NotFoundError('workflow', id);
    if (target.status === 'archived') {
      throw new LoopError('VALIDATION_INVALID', 'Cannot execute an archived workflow', 409);
    }
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

  // Audit #23: exchange REST credentials for a single-use, short-lived WS
  // ticket so long-lived tokens never travel in the WebSocket URL.
  app.post('/api/v1/executions/:id/ws-ticket', async (request) => {
    const { id } = request.params as { id: string };
    const execution = await deps.store.executions.getById(id);
    if (!execution) throw new NotFoundError('execution', id);
    const { ticket, expires_in } = issueExecutionTicket(id);
    return { success: true, data: { ticket, expires_in }, meta: meta(request) };
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

  app.post('/api/v1/executions/:id/replay', async (request) => {
    const { id } = request.params as { id: string };
    if (replaysInFlight.has(id)) {
      throw new LoopError('REPLAY_IN_PROGRESS', `A replay of execution '${id}' is already in progress`, 409);
    }
    replaysInFlight.add(id);
    try {
      const query = request.query as Record<string, string>;
      const dryRun = query['dryRun'] !== 'false'; // default true (read-only)
      if (!dryRun) {
        // Only terminal executions may be re-executed: replaying a
        // running/pending one starts a SECOND executor on the same id —
        // connector side effects fire twice (duplicate emails, double
        // writes to Vault/Desk).
        const execution = await deps.store.executions.getById(id);
        if (execution && (execution.status === 'running' || execution.status === 'pending' || execution.status === 'paused')) {
          throw new LoopError('REPLAY_NOT_TERMINAL', `Execution '${id}' is ${execution.status}; only terminal executions can be replayed (dryRun=false)`, 409);
        }
      }
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
    if (body.trigger_type === 'webhook') {
      // Audit #66: the catch-all TriggerConfigSchema union accepts any object,
      // so enforce the webhook branch here (same pattern as cron/event). A
      // secret-less webhook trigger lets anyone who learns the trigger id fire
      // executions with arbitrary payloads, unsigned.
      const secret = body.config['secret'];
      if (typeof secret !== 'string' || secret.length < 16) {
        throw new LoopError('VALIDATION_REQUIRED', 'webhook triggers require config.secret (at least 16 characters)', 400);
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

  const UpdateTriggerRequestSchema = z.object({
    config: z.record(z.unknown()).optional(),
    enabled: z.boolean().optional(),
  });

  // Update config / enable-disable a trigger. For cron triggers the schedule
  // is resynchronized so the change takes effect without a restart (A3).
  app.put('/api/v1/triggers/:triggerId', async (request) => {
    const { triggerId } = request.params as { triggerId: string };
    const body = parseBody(UpdateTriggerRequestSchema, request.body);
    const existing = await deps.store.triggers.getById(triggerId);
    if (!existing) throw new NotFoundError('trigger', triggerId);
    if (body.config === undefined && body.enabled === undefined) {
      throw new LoopError('VALIDATION_REQUIRED', 'Provide config and/or enabled', 400);
    }

    await deps.store.triggers.update(triggerId, {
      ...(body.config !== undefined ? { config: body.config } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    });

    if (existing.trigger_type === 'cron') {
      const updated = await deps.store.triggers.getById(triggerId);
      // Audit #62: register() validates before swapping jobs, so a rejected
      // expression leaves the OLD schedule running. Only unregister when the
      // trigger is being disabled.
      if (updated?.enabled) {
        try {
          deps.cronHandler.register(triggerId, updated.workflow_id, (updated.config ?? {}) as { expression: string; timezone?: string });
        } catch (err) {
          // New config has an invalid expression — roll it back so the DB and
          // scheduler stay consistent, and report a 400 instead of 500.
          await deps.store.triggers.update(triggerId, {
            ...(body.config !== undefined ? { config: existing.config } : {}),
            ...(body.enabled !== undefined ? { enabled: existing.enabled } : {}),
          });
          const detail = err instanceof Error ? err.message : String(err);
          throw new LoopError('VALIDATION_INVALID', `Invalid cron expression: ${detail}`, 400);
        }
      } else {
        deps.cronHandler.unregister(triggerId);
      }
    }

    const trigger = await deps.store.triggers.getById(triggerId);
    // Audit #18: never echo the webhook signing secret on update — the GET
    // list already redacts it; PUT must not re-expose it to editors.
    return { success: true, data: trigger ? redactTriggerSecrets(trigger) : trigger, meta: meta(request) };
  });

  app.get('/api/v1/workflows/:id/triggers', async (request) => {
    const { id: workflowId } = request.params as { id: string };
    const triggers = await deps.store.triggers.listByWorkflow(workflowId);
    // Webhook signing secrets never leave the API, even for editors — the
    // response is cached/logged in too many places to treat as secret-safe.
    return { success: true, data: triggers.map(redactTriggerSecrets), meta: meta(request) };
  });

  // ─── Events (§5.5 event triggers) — the dispatcher creates *pending*
  // executions; run them like the cron/webhook/manual paths do, otherwise
  // event triggers create records that never execute (A1: previously the
  // dispatcher had no caller at all, so event triggers were unusable).

  const EventRequestSchema = z.object({
    source: z.string().min(1).max(200),
    event_type: z.string().min(1).max(200),
    payload: z.record(z.unknown()).default({}),
  });

  /** Fire-and-forget an execution for a workflow id (mirrors /execute). */
  function runExecution(executionId: string, workflowId: string, payload: Record<string, unknown>): void {
    void (async () => {
      try {
        const workflow = await deps.authoring.getById(workflowId);
        await deps.executor.execute(executionId, workflow.definition, payload);
      } catch (err) {
        await deps.store.executions
          .completeIfActive(executionId, {
            status: 'failed',
            completed_at: new Date().toISOString(),
            error: String(err),
          })
          .catch(() => {});
      }
    })();
  }

  app.post('/api/v1/events', async (request, reply) => {
    const body = parseBody(EventRequestSchema, request.body);
    const executionIds = await deps.triggerDispatcher.dispatch({
      source: body.source,
      event_type: body.event_type,
      payload: body.payload,
    });
    // Dispatch matched → schedule each created execution.
    for (const executionId of executionIds) {
      const execution = await deps.store.executions.getById(executionId);
      if (execution) runExecution(executionId, execution.workflow_id, execution.trigger_payload ?? {});
    }
    return reply.status(executionIds.length > 0 ? 202 : 200).send({
      success: true,
      data: { matched_triggers: executionIds.length, execution_ids: executionIds },
      meta: meta(request),
    });
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
    // Redact credential material: config.api_key is a live secret for the
    // upstream product (Vault/Desk/Recap). Any viewer+ could previously read
    // it straight out of the list endpoint.
    return { success: true, data: connectors.map(redactConnectorSecrets), meta: meta(request) };
  });

  const CreateConnectorRequestSchema = z.object({
    connector_type: z.enum(['vault', 'desk', 'recap', 'generic']),
    name: z.string().trim().min(1).max(200),
    config: z.record(z.unknown()).default({}),
  });

  // Create a connector instance: persist the row AND register it live so the
  // very next execution can use it (B4 — previously GET /connectors listed DB
  // rows the executor never knew about, and there was no create path).
  app.post('/api/v1/connectors', async (request, reply) => {
    const body = parseBody(CreateConnectorRequestSchema, request.body);
    if (!deps.connectors.getAdapter(body.connector_type)) {
      throw new LoopError('VALIDATION_REQUIRED', `No adapter registered for connector type '${body.connector_type}'`, 400);
    }
    const connectorId = crypto.randomUUID();
    // V1.7 (L-2): `api_key` goes into the encrypted secrets store, NOT the
    // plaintext config JSON column — the executor resolves it at dispatch time
    // via its secretResolver. The registry row keeps only non-sensitive fields.
    const { api_key: apiKey, ...configWithoutSecret } = body.config ?? {};
    let storedConfig = configWithoutSecret as Record<string, unknown>;
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      await deps.secretsManager.set({
        name: 'api_key',
        value: apiKey,
        scope: 'connector',
        scope_id: connectorId,
        created_by: 'api',
      });
    } else {
      storedConfig = body.config ?? {};
    }
    // Audit #19: header credentials (authorization) must not stay plaintext in
    // the config JSON — move them into the encrypted secrets store; the
    // executor resolves them at dispatch like api_key.
    const headers = storedConfig['headers'];
    if (headers !== null && typeof headers === 'object' && !Array.isArray(headers)) {
      const authHeader = (headers as Record<string, unknown>)['authorization'];
      if (typeof authHeader === 'string' && authHeader.length > 0) {
        await deps.secretsManager.set({
          name: 'header.authorization',
          value: authHeader,
          scope: 'connector',
          scope_id: connectorId,
          created_by: 'api',
        });
        const { authorization: _drop, ...restHeaders } = headers as Record<string, unknown>;
        storedConfig = { ...storedConfig, headers: restHeaders };
      }
    }
    const connector = await deps.store.connectors.create({
      id: connectorId,
      connector_type: body.connector_type,
      name: body.name,
      config: storedConfig,
    });
    deps.connectors.registerInstance(connector.id, body.connector_type, storedConfig);
    return reply.status(201).send({ success: true, data: connector, meta: meta(request) });
  });

  app.delete('/api/v1/connectors/:id', async (request) => {
    const { id } = request.params as { id: string };
    const connector = await deps.store.connectors.getById(id);
    if (!connector) throw new NotFoundError('connector', id);
    deps.connectors.unregisterInstance(id);
    await deps.store.connectors.delete(id);
    return { success: true, data: { id, deleted: true }, meta: meta(request) };
  });

  // ─── Egress policy management (admin) — without these routes the gate was
  // only configurable by writing rows directly to the database.

  const EgressPolicyRequestSchema = z.object({
    name: z.string().trim().min(1).max(200),
    rule_type: z.enum(['allow', 'deny']),
    target_type: z.enum(['domain', 'ip_range', 'region']),
    target_value: z.string().trim().min(1).max(500),
    priority: z.number().int().min(-10000).max(10000).default(0),
  });

  app.get('/api/v1/egress/policies', { preHandler: [requireRole('admin')] }, async (request) => {
    const policies = await deps.store.egressPolicies.list();
    return { success: true, data: policies, meta: meta(request) };
  });

  app.post('/api/v1/egress/policies', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const body = parseBody(EgressPolicyRequestSchema, request.body);
    // Audit #42: lookupRegion is a permanent stub (no GeoIP source) — region
    // policies can NEVER match. Reject them at configuration time instead of
    // letting operators believe a data-residency deny rule is enforced.
    if (body.target_type === 'region') {
      throw new LoopError('VALIDATION_INVALID', 'region policies are not enforceable yet (no GeoIP source); use domain or ip_range', 400);
    }
    const id = crypto.randomUUID();
    await deps.store.egressPolicies.create({ id, ...body });
    deps.egressEngine.invalidateCache();
    return reply.status(201).send({ success: true, data: { id, ...body }, meta: meta(request) });
  });

  const UpdateEgressPolicySchema = z.object({
    name: z.string().trim().min(1).max(200).optional(),
    rule_type: z.enum(['allow', 'deny']).optional(),
    target_type: z.enum(['domain', 'ip_range', 'region']).optional(),
    target_value: z.string().trim().min(1).max(500).optional(),
    priority: z.number().int().min(-10000).max(10000).optional(),
    enabled: z.boolean().optional(),
  });

  app.put('/api/v1/egress/policies/:id', { preHandler: [requireRole('admin')] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = parseBody(UpdateEgressPolicySchema, request.body);
    // Audit #94: report 404 for nonexistent ids instead of a phantom success.
    if (!(await deps.store.egressPolicies.list()).some((p) => p.id === id)) {
      throw new NotFoundError('egress_policy', id);
    }
    // Audit #42: see POST — region policies cannot be enforced yet.
    if (body.target_type === 'region') {
      throw new LoopError('VALIDATION_INVALID', 'region policies are not enforceable yet (no GeoIP source); use domain or ip_range', 400);
    }
    await deps.store.egressPolicies.update(id, body);
    deps.egressEngine.invalidateCache();
    return { success: true, data: { id, updated: true }, meta: meta(request) };
  });

  app.delete('/api/v1/egress/policies/:id', { preHandler: [requireRole('admin')] }, async (request) => {
    const { id } = request.params as { id: string };
    // Audit #94: report 404 for nonexistent ids instead of a phantom success.
    if (!(await deps.store.egressPolicies.list()).some((p) => p.id === id)) {
      throw new NotFoundError('egress_policy', id);
    }
    await deps.store.egressPolicies.delete(id);
    deps.egressEngine.invalidateCache();
    return { success: true, data: { id, deleted: true }, meta: meta(request) };
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
    const known = deps.llmRouter.listProviders().map((p) => p.name);
    // An unknown provider is a 400 client error — never a 500, and never a
    // silent vendor switch (the router throws for unknown chain entries).
    if (body.provider !== undefined && !known.includes(body.provider)) {
      throw new LoopError('VALIDATION_REQUIRED', `Unknown LLM provider '${body.provider}'. Configured: ${known.join(', ') || 'none'}`, 400);
    }
    const messages: ChatMessage[] = body.messages ?? [
      ...(body.system ? [{ role: 'system' as const, content: body.system }] : []),
      { role: 'user' as const, content: body.prompt! },
    ];
    // Audit #20: an explicitly forced provider is exclusive — no silent
    // fallback to cloud vendors (an egress-blocked local provider must surface
    // as an error, not leak the prompt to another vendor).
    const chain = body.provider ? [body.provider] : undefined;
    // API-side calls must pass the SAME egress gate as workflow nodes —
    // otherwise airgap mode only covered the executor path (B1).
    const result = await deps.llmRouter.complete(
      {
        model: body.model ?? '',
        messages,
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
      },
      chain,
      { egress: deps.egressGate },
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
    // Audit #55: scoped secrets must name their scope target — a scope-less
    // connector/workflow secret would land in the NULL-scope row and shadow
    // same-named secrets unpredictably.
    if (body.scope !== 'global' && body.scope_id === undefined) {
      throw new LoopError('VALIDATION_REQUIRED', `scope '${body.scope}' requires scope_id`, 400);
    }
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
      // Composite uniqueness (name, scope, scope_id): a same-scope duplicate
      // surfaces as 409, not 500 (audit #12/#55).
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
