/**
 * Loop API server — Fastify HTTP/WS server hosting all @loop/* modules.
 *
 * Entry point: starts the server, runs migrations, registers all routes.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { createLogger } from '@loop/observability';
import { collectMetrics } from '@loop/observability';
import { createSqliteConnection, createPostgresConnection } from '@loop/state';
import { SqliteStateStore, PostgresStateStore } from '@loop/state';
import type { StateStore } from '@loop/state';
import { ConnectorRegistry, VaultAdapter, DeskAdapter, RecapAdapter, GenericAdapter, LlmConnectorAdapter } from '@loop/connectors';
import { WorkflowAuthoringService } from '@loop/workflow-authoring';
import { GitBackend, VersioningService } from '@loop/versioning';
import { ExecutionExecutor, ExecutionRecovery, executionEventBus } from '@loop/engine';
import { TriggerDispatcher, CronTriggerHandler, WebhookTriggerHandler, ManualTriggerHandler } from '@loop/triggers';
import { EgressEngine, EgressGate } from '@loop/egress';
import { SecretsManager } from '@loop/secrets';
import { TemplateRegistry } from '@loop/templates';
import { createLLMRouter } from '@loop/llm';
import { loadConfig, type LoopConfig } from './config.js';
import { registerRoutes } from './routes/index.js';
import { registerExecutionWebSocket } from './routes/ws.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestIdHook } from './middleware/requestId.js';
import { traceIdHook } from './middleware/traceId.js';

const logger = createLogger({ name: 'loop:api', component: 'api' });

export async function buildApp(config?: LoopConfig): Promise<FastifyInstance> {
  const cfg = config ?? loadConfig();

  const app = Fastify({
    logger: false, // We use our own Pino logger
    requestTimeout: cfg.LOOP_EXECUTION_TIMEOUT_MS,
  });

  // ─── Middleware & hooks ──────────────────────────────────────────────────

  app.addHook('onRequest', requestIdHook);
  // V1.5 M1 (F-3, TR1): distributed tracing — read/generate X-Trace-Id and run
  // the request lifecycle inside a correlation context carrying trace_id.
  app.addHook('onRequest', traceIdHook);

  // CORS. Bearer-header auth (no cookies) means credentials are not needed;
  // reflecting any origin with credentials:true would become an exploit the
  // moment cookie auth is introduced.
  await app.register(import('@fastify/cors'), {
    origin: true,
    credentials: false,
  });

  // Capture the raw request body on the raw IncomingMessage so byte-exact
  // HMAC verification is possible on /webhooks/:triggerId (tsd §11.6: the
  // signature is computed over the raw body; re-serialising the parsed body
  // is not guaranteed to reproduce the sender's bytes).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as { rawBody?: Buffer }).rawBody = body as Buffer;
    const text = (body as Buffer).toString('utf8');
    if (text.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  // Rate limiting (configurable; LOOP_RATE_LIMIT_MAX=0 disables). Health/ready/
  // metrics are exempt so monitoring is never throttled. The previous hardcoded
  // 100/min per IP blocked legitimate multi-user traffic from a shared IP
  // (found via 100-user load testing — see RUNTIME_VERIFICATION.md).
  if (cfg.LOOP_RATE_LIMIT_MAX > 0) {
    await app.register(import('@fastify/rate-limit'), {
      max: cfg.LOOP_RATE_LIMIT_MAX,
      timeWindow: cfg.LOOP_RATE_LIMIT_WINDOW,
      allowList: (req) => {
        const path = req.url.split('?')[0];
        return path === '/health' || path === '/ready' || path === '/metrics';
      },
    });
  }

  // Global error handler
  app.setErrorHandler(errorHandler);

  // ─── State store ─────────────────────────────────────────────────────────

  // Honour LOOP_DB_TYPE — the Postgres Scale layer existed but was never
  // reachable, so configured deployments silently ran on SQLite (M8).
  let store: StateStore;
  if (cfg.LOOP_DB_TYPE === 'postgres') {
    const pgConn = createPostgresConnection({
      host: cfg.LOOP_DB_HOST ?? 'localhost',
      port: cfg.LOOP_DB_PORT ?? 5432,
      database: cfg.LOOP_DB_NAME ?? 'loop',
      user: cfg.LOOP_DB_USER ?? 'loop',
      password: cfg.LOOP_DB_PASSWORD ?? '',
      ssl: cfg.LOOP_DB_SSL,
    });
    store = new PostgresStateStore(pgConn);
  } else {
    store = new SqliteStateStore(createSqliteConnection({ path: cfg.LOOP_DB_PATH }));
  }
  await store.initialise();

  // Seed a default system user (required for FK constraints on created_by)
  const existingSystemUser = await store.users.getById('system');
  if (!existingSystemUser) {
    await store.users.create({
      id: 'system',
      username: 'system',
      password_hash: '',
      email: 'system@loop.internal',
      role: 'admin',
      display_name: 'System',
    });
  }

  // ─── Services ────────────────────────────────────────────────────────────

  const connectors = new ConnectorRegistry();
  connectors.registerAdapter(new VaultAdapter());
  connectors.registerAdapter(new DeskAdapter());
  connectors.registerAdapter(new RecapAdapter());
  connectors.registerAdapter(new GenericAdapter());

  // Egress gate first — the executor below hands it to every connector call.
  const egressEngine = new EgressEngine(() => store.egressPolicies.listEnabled());
  const egressGate = new EgressGate(egressEngine, {
    airgap: cfg.LOOP_AIRGAP_MODE,
    unconfiguredPolicy: cfg.LOOP_EGRESS_UNCONFIGURED_POLICY,
  });

  // LLM router — builds the vendor chain from LOOP_LLM_* env (keyed cloud
  // vendors, native Gemini/Anthropic, local Ollama/vLLM/LM Studio). Registered
  // as a connector so workflows get the `llm.complete` node type; the same
  // egress gate and timeout signal guard model calls as any other HTTP call.
  const llmRouter = createLLMRouter(cfg);
  connectors.registerAdapter(new LlmConnectorAdapter(llmRouter));

  // Register configured connector instances so the executor resolves a real
  // base_url + credentials at dispatch time (INTEGRATION_CONTRACT.md §4.2).
  if (cfg.LOOP_VAULT_URL) {
    connectors.registerInstance('vault-default', 'vault', {
      base_url: cfg.LOOP_VAULT_URL,
      ...(cfg.LOOP_VAULT_API_KEY ? { api_key: cfg.LOOP_VAULT_API_KEY } : {}),
    });
  }
  if (cfg.LOOP_DESK_URL) {
    connectors.registerInstance('desk-default', 'desk', {
      base_url: cfg.LOOP_DESK_URL,
      ...(cfg.LOOP_DESK_API_KEY ? { api_key: cfg.LOOP_DESK_API_KEY } : {}),
    });
  }
  if (cfg.LOOP_RECAP_URL) {
    connectors.registerInstance('recap-default', 'recap', {
      base_url: cfg.LOOP_RECAP_URL,
      ...(cfg.LOOP_RECAP_API_KEY ? { api_key: cfg.LOOP_RECAP_API_KEY } : {}),
    });
  }

  const gitBackend = new GitBackend({ repoPath: `${cfg.LOOP_DATA_DIR}/git` });
  await gitBackend.initialise();
  const versioning = new VersioningService(store, gitBackend);
  const authoring = new WorkflowAuthoringService(store, versioning);
  const executor = new ExecutionExecutor(
    store,
    connectors,
    cfg.LOOP_MAX_CONCURRENT,
    cfg.LOOP_NODE_TIMEOUT_MS,
    cfg.LOOP_WORKFLOW_TIMEOUT_MS,
    // V1.1 M2 (F5): publish node/execution status to the same bus the WS route
    // subscribes to (wired below) for real-time monitoring.
    executionEventBus,
    // V1.2 M3: sub-workflow recursion ceiling — keep the executor default.
    undefined,
    // V1.4 M2 (F-2): size cap for the node output persisted into event payloads.
    cfg.LOOP_EVENT_OUTPUT_MAX_BYTES,
    // Egress gate — enforced before every outbound connector call.
    egressGate,
  );
  const triggerDispatcher = new TriggerDispatcher(store);
  const cronHandler = new CronTriggerHandler(store, async ({ executionId, workflowId, payload }) => {
    await dispatchToExecutor(executionId, workflowId, payload);
  });
  const webhookHandler = new WebhookTriggerHandler(store);
  const manualHandler = new ManualTriggerHandler(store);
  // The gate is what makes airgap mode and egress policies real: the executor
  // hands it to every connector call, which must clear it before dispatching
  // (previously the whole egress stack was dead code — SSRF).
  const secretsManager = new SecretsManager(store, cfg.LOOP_ENCRYPTION_KEY);

  // Template marketplace registry — loads templates/*.json once at startup.
  // Files failing schema validation are skipped (recorded in loadErrors)
  // rather than blocking the server; warn so operators notice drift.
  const templates = new TemplateRegistry();
  if (templates.getLoadErrors().length > 0) {
    logger.warn({ errors: templates.getLoadErrors() }, 'Template registry skipped invalid template files');
  }

  // ─── Execution recovery on startup ───────────────────────────────────────

  // Re-dispatch recovered executions to the executor — resetting to 'pending'
  // alone leaves them stuck because nothing polls the store (bugs 12/13).
  // The closure fire-and-forgets execute() so startup is not blocked.
  async function dispatchToExecutor(
    executionId: string,
    workflowId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const workflow = await authoring.getById(workflowId);
    void executor.execute(executionId, workflow.definition, payload).catch((err) => {
      // Guarded transition — never overwrite an API-initiated 'cancelled'.
      store.executions
        .completeIfActive(executionId, {
          status: 'failed',
          completed_at: new Date().toISOString(),
          error: String(err),
        })
        .catch(() => {});
    });
  }

  const recovery = new ExecutionRecovery(store, async (execution) => {
    await dispatchToExecutor(
      execution.id,
      execution.workflow_id,
      (execution.trigger_payload ?? {}) as Record<string, unknown>,
    );
  });
  await recovery.recover();

  // ─── Cron triggers ──────────────────────────────────────────────────────

  await cronHandler.initialise();

  // ─── Routes ──────────────────────────────────────────────────────────────

  registerRoutes(app, {
    store,
    connectors,
    authoring,
    executor,
    triggerDispatcher,
    cronHandler,
    webhookHandler,
    manualHandler,
    egressEngine,
    secretsManager,
    templates,
    llmRouter,
    config: cfg,
  });

  // ─── Real-time execution monitoring (V1.1 M2, F5) ────────────────────────
  // Subscribes WS clients to the same EventBus the executor publishes node /
  // execution status transitions to.
  await registerExecutionWebSocket(app, { config: cfg, store, eventBus: executionEventBus });

  // ─── Health / readiness / metrics (§5.9) ─────────────────────────────────

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async () => ({
    status: 'ready',
    checks: { database: 'ok', connectors: 'ok' },
  }));
  app.get('/metrics', async (_req, reply) => {
    const metrics = await collectMetrics();
    reply.type('text/plain').send(metrics);
  });

  // ─── Shutdown ────────────────────────────────────────────────────────────

  app.addHook('onClose', async () => {
    cronHandler.shutdown();
    await store.close();
    logger.info('Server closed');
  });

  return app;
}

// ─── Main entry ─────────────────────────────────────────────────────────────

async function main() {
  const cfg = loadConfig();
  const app = await buildApp(cfg);

  try {
    await app.listen({ port: cfg.LOOP_PORT, host: cfg.LOOP_HOST });
    logger.info({ port: cfg.LOOP_PORT, host: cfg.LOOP_HOST, env: cfg.LOOP_ENV }, 'Loop API started');
  } catch (err) {
    logger.fatal({ error: String(err) }, 'Failed to start server');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
