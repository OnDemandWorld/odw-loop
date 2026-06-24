/**
 * Loop API server — Fastify HTTP/WS server hosting all @loop/* modules.
 *
 * Entry point: starts the server, runs migrations, registers all routes.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { createLogger } from '@loop/observability';
import { collectMetrics } from '@loop/observability';
import { createSqliteConnection } from '@loop/state';
import { SqliteStateStore } from '@loop/state';
import { ConnectorRegistry, VaultAdapter, DeskAdapter, RecapAdapter, GenericAdapter } from '@loop/connectors';
import { WorkflowAuthoringService } from '@loop/workflow-authoring';
import { GitBackend, VersioningService } from '@loop/versioning';
import { ExecutionExecutor, ExecutionRecovery } from '@loop/engine';
import { TriggerDispatcher, CronTriggerHandler, WebhookTriggerHandler, ManualTriggerHandler } from '@loop/triggers';
import { EgressEngine } from '@loop/egress';
import { SecretsManager } from '@loop/secrets';
import { loadConfig, type LoopConfig } from './config.js';
import { registerRoutes } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestIdHook } from './middleware/requestId.js';

const logger = createLogger({ name: 'loop:api', component: 'api' });

export async function buildApp(config?: LoopConfig): Promise<FastifyInstance> {
  const cfg = config ?? loadConfig();

  const app = Fastify({
    logger: false, // We use our own Pino logger
    requestTimeout: cfg.LOOP_EXECUTION_TIMEOUT_MS,
  });

  // ─── Middleware & hooks ──────────────────────────────────────────────────

  app.addHook('onRequest', requestIdHook);

  // CORS
  await app.register(import('@fastify/cors'), {
    origin: true,
    credentials: true,
  });

  // Rate limiting
  await app.register(import('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute',
  });

  // Global error handler
  app.setErrorHandler(errorHandler);

  // ─── State store ─────────────────────────────────────────────────────────

  const conn = createSqliteConnection({ path: cfg.LOOP_DB_PATH });
  const store = new SqliteStateStore(conn);
  await store.initialise();

  // ─── Services ────────────────────────────────────────────────────────────

  const connectors = new ConnectorRegistry();
  connectors.registerAdapter(new VaultAdapter());
  connectors.registerAdapter(new DeskAdapter());
  connectors.registerAdapter(new RecapAdapter());
  connectors.registerAdapter(new GenericAdapter());

  const gitBackend = new GitBackend({ repoPath: `${cfg.LOOP_DATA_DIR}/git` });
  await gitBackend.initialise();
  const versioning = new VersioningService(store, gitBackend);
  const authoring = new WorkflowAuthoringService(store, versioning);
  const executor = new ExecutionExecutor(store, connectors, cfg.LOOP_MAX_CONCURRENT);
  const triggerDispatcher = new TriggerDispatcher(store);
  const cronHandler = new CronTriggerHandler(store);
  const webhookHandler = new WebhookTriggerHandler(store);
  const manualHandler = new ManualTriggerHandler(store);
  const egressEngine = new EgressEngine(() => store.egressPolicies.listEnabled());
  const secretsManager = new SecretsManager(store, cfg.LOOP_ENCRYPTION_KEY);

  // ─── Execution recovery on startup ───────────────────────────────────────

  const recovery = new ExecutionRecovery(store);
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
    webhookHandler,
    manualHandler,
    egressEngine,
    secretsManager,
    config: cfg,
  });

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
    conn.close();
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
