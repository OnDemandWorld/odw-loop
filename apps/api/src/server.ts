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
import { attachRawBodyParser } from './raw-body.js';
import { SecretsManager } from '@loop/secrets';
import { TemplateRegistry } from '@loop/templates';
import { createLLMRouter } from '@loop/llm';
import { loadConfig, type LoopConfig } from './config.js';
import { registerRoutes } from './routes/index.js';
import { registerAuthRoutes, bootstrapAdminUser } from './routes/auth.js';
import { registerExecutionWebSocket } from './routes/ws.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestIdHook } from './middleware/requestId.js';
import { traceIdHook } from './middleware/traceId.js';

const logger = createLogger({ name: 'loop:api', component: 'api' });

export async function buildApp(config?: LoopConfig): Promise<FastifyInstance> {
  const cfg = config ?? loadConfig();

  const app = Fastify({
    logger: false, // We use our own Pino logger
    // Fastify's requestTimeout is the idle/request-socket deadline, not a
    // workflow budget: wiring LOOP_EXECUTION_TIMEOUT_MS here made any HTTP
    // request older than the (default 300s) execution budget fail with a
    // generic timeout, while executions actually run detached from the
    // request. Give sockets a generous fixed ceiling instead.
    requestTimeout: 600_000,
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
  // HMAC verification is possible on /webhooks/:triggerId (tsd §11.6).
  // Shared with the integration test helper so tests exercise the same path.
  attachRawBodyParser(app);

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
    allowPrivate: cfg.LOOP_EGRESS_ALLOW_PRIVATE,
  });
  // V1.7 (L-2): encrypted secrets store — created early so the legacy
  // credential migration below and the executor's secretResolver share it.
  const secretsManager = new SecretsManager(store, cfg.LOOP_ENCRYPTION_KEY);

  // LLM router — builds the vendor chain from LOOP_LLM_* env (keyed cloud
  // vendors, native Gemini/Anthropic, local Ollama/vLLM/LM Studio). Registered
  // as a connector so workflows get the `llm.complete` node type; the same
  // egress gate and timeout signal guard model calls as any other HTTP call.
  const llmRouter = createLLMRouter(cfg);
  // B3: Ollama is always registered, so an unconfigured deployment silently
  // targets localhost — make that visible in the logs.
  if (llmRouter.listProviders().every((p) => p.name === 'ollama')) {
    logger.warn('No LOOP_LLM_* cloud keys configured — llm.complete nodes will only reach the local Ollama endpoint');
  }
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

  // Load persisted connector instances (rows created via POST /api/v1/connectors)
  // into the same registry the executor reads — previously the DB table and the
  // runtime registry were fully disconnected, so GET /connectors listed rows
  // that no execution ever used (and env instances never showed up).
  // V1.7 (L-2): one-time migration — legacy rows carry `api_key` (and
  // `headers.authorization`) as PLAINTEXT inside the config JSON column. Move
  // them into the encrypted secrets store and rewrite the row without the
  // sensitive fields; the executor resolves credentials via secretResolver.
  for (const row of await store.connectors.list()) {
    if (!connectors.getAdapter(row.connector_type)) {
      logger.warn({ connectorId: row.id, type: row.connector_type }, 'Skipping stored connector instance — adapter type not registered');
      continue;
    }
    let config = row.config;
    const apiKey = config?.['api_key'];
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      try {
        await secretsManager.set({
          name: 'api_key',
          value: apiKey,
          scope: 'connector',
          scope_id: row.id,
          created_by: 'system-migration',
        });
        const { api_key: _drop, ...rest } = config as Record<string, unknown>;
        config = rest;
        await store.connectors.update(row.id, { config });
        logger.info({ connectorId: row.id }, 'Migrated legacy plaintext api_key into encrypted secrets store');
      } catch (err) {
        logger.warn({ connectorId: row.id, error: String(err) }, 'Failed to migrate legacy api_key — keeping inline config');
      }
    }
    connectors.registerInstance(row.id, row.connector_type, config);
  }
  // Surface silent cross-product fallback: when a sibling URL is unset the
  // connector silently uses its hardcoded adapter default, which hides
  // misconfiguration (e.g. a port conflict on the default). Warn loudly.
  for (const [product, url] of [
    ['VAULT', cfg.LOOP_VAULT_URL],
    ['DESK', cfg.LOOP_DESK_URL],
    ['RECAP', cfg.LOOP_RECAP_URL],
  ] as const) {
    if (!url) {
      logger.warn(
        { product: product.toLowerCase() },
        `LOOP_${product}_URL not set — vault/desk/recap connector nodes will use the adapter's default localhost URL`,
      );
    }
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
    // V1.7 (L-2): resolve `api_key` for a connector instance from the
    // encrypted secrets store (set via POST /api/v1/connectors) before
    // falling back to the instance's inline config (env-registered instances).
    async (name, scope, scopeId) => secretsManager.get(name, scope, scopeId),
    // V1.7 (L-9): executor-wide default retry from config — previously
    // LOOP_DEFAULT_RETRY_* was dead config and every node ran zero retries.
    {
      max_attempts: cfg.LOOP_DEFAULT_RETRY_COUNT,
      backoff: cfg.LOOP_DEFAULT_BACKOFF,
      initial_delay_ms: cfg.LOOP_DEFAULT_BACKOFF_INITIAL_MS,
    },
  );
  const triggerDispatcher = new TriggerDispatcher(store);
  const cronHandler = new CronTriggerHandler(store, async ({ executionId, workflowId, payload }) => {
    await dispatchToExecutor(executionId, workflowId, payload);
  });
  const webhookHandler = new WebhookTriggerHandler(store);
  const manualHandler = new ManualTriggerHandler(store);
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

  // V1.7 (L-8): JWT issuance so RBAC roles are reachable without the shared
  // static API key. Login is exempt from the auth guard (public prefix).
  await bootstrapAdminUser(store, cfg).catch((err) => {
    logger.warn({ error: String(err) }, 'Bootstrap admin seeding failed');
  });
  registerAuthRoutes(app, { store, config: cfg });
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
    egressGate,
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
  app.get('/ready', async () => {
    // Probe registered cross-product connector instances for real (bounded so a
    // dead sibling can never wedge the readiness probe). Instances fall back to
    // their adapter default base URLs when LOOP_*_URL is unset.
    const connectorResults = await connectors.healthCheckAll();
    const connectorDetail: Record<string, string> = {};
    for (const [id, ok] of connectorResults) connectorDetail[id] = ok ? 'ok' : 'unreachable';
    const connectorsOk =
      connectorResults.size === 0 || [...connectorResults.values()].every(Boolean);
    return {
      status: 'ready',
      checks: {
        database: 'ok',
        connectors: connectorsOk ? 'ok' : 'degraded',
        ...connectorDetail,
      },
    };
  });
  app.get('/metrics', async (_req, reply) => {
    const metrics = await collectMetrics();
    reply.type('text/plain').send(metrics);
  });

  // ─── Shutdown ────────────────────────────────────────────────────────────

  app.addHook('onClose', async () => {
    // Stop scheduled triggers FIRST so no new cron executions start during the
    // drain window — a tick mid-drain would otherwise spawn work that outlives
    // the graceful-shutdown budget.
    cronHandler.shutdown();
    // V1.7 (L-10): wait (bounded) for in-flight executions so side effects are
    // not severed mid-flight; recovery remains the safety net for the rest.
    const drained = await executor.drain(10_000);
    if (!drained) {
      logger.warn('Executor drain timed out — in-flight executions will be recovered on next startup');
    }
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

  // Graceful shutdown: docker stop / pod eviction sends SIGTERM. Without a
  // handler Node terminates immediately — in-flight executions are severed
  // (recovery then marks never-progressed runs as failed), cron jobs never
  // stop, and the SQLite store skips its clean close (the 'exit' hook does
  // not run on default signal termination). app.close() drains connections
  // and runs the onClose hook; the timer guarantees we still exit if a
  // handler hangs.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');
    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 20_000);
    forceExit.unref();
    try {
      await app.close();
    } catch (err) {
      logger.error({ error: String(err) }, 'Error during graceful shutdown');
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
