/**
 * Shared test helpers for integration tests.
 *
 * Provides a test Fastify app wired to an in-memory SQLite database,
 * seeded with a system user so workflow foreign keys resolve.
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import {
  createSqliteConnection,
  SqliteStateStore,
  type SqliteConnection,
} from '../../../packages/state/src/index.js';
import { ConnectorRegistry, VaultAdapter, DeskAdapter } from '../../../packages/connectors/src/index.js';
import { WorkflowAuthoringService } from '../../../packages/workflow-authoring/src/index.js';
import { VersioningService, GitBackend } from '../../../packages/versioning/src/index.js';
import { ExecutionExecutor } from '../../../packages/engine/src/index.js';
import {
  TriggerDispatcher,
  WebhookTriggerHandler,
  ManualTriggerHandler,
} from '../../../packages/triggers/src/index.js';
import { EgressEngine } from '../../../packages/egress/src/index.js';
import { SecretsManager } from '../../../packages/secrets/src/index.js';
import { registerRoutes } from '../../../apps/api/src/routes/index.js';
import { errorHandler } from '../../../apps/api/src/middleware/errorHandler.js';
import type { LoopConfig } from '../../../apps/api/src/config.js';
import type { WorkflowDefinition } from '../../../packages/types/src/index.js';

export const SYSTEM_USER_ID = 'system';

export interface TestApp {
  app: FastifyInstance;
  store: SqliteStateStore;
  conn: SqliteConnection;
  connectors: ConnectorRegistry;
  authoring: WorkflowAuthoringService;
  executor: ExecutionExecutor;
  webhookHandler: WebhookTriggerHandler;
  manualHandler: ManualTriggerHandler;
  triggerDispatcher: TriggerDispatcher;
  egressEngine: EgressEngine;
  secretsManager: SecretsManager;
  config: LoopConfig;
}

/**
 * Build a test Fastify app backed by an in-memory SQLite database and a
 * temp-directory git repo for versioning. Seeds a system user with role 'admin'
 * so workflow foreign keys resolve and workflow authoring has a valid creator.
 */
export async function buildTestApp(): Promise<TestApp> {
  const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-test-'));
  const dbPath = path.join(tmpDataDir, 'test.db');

  const config: LoopConfig = {
    LOOP_PORT: 0,
    LOOP_HOST: '127.0.0.1',
    LOOP_LOG_LEVEL: 'error',
    LOOP_ENV: 'test',
    LOOP_DATA_DIR: tmpDataDir,
    LOOP_ENCRYPTION_KEY: 'test-key-change-me-please-32chars!',
    LOOP_DB_TYPE: 'sqlite',
    LOOP_DB_PATH: dbPath,
    LOOP_DB_SSL: false,
    LOOP_MAX_CONCURRENT: 10,
    LOOP_EXECUTION_TIMEOUT_MS: 5_000,
    LOOP_NODE_TIMEOUT_MS: 1_000,
    LOOP_DEFAULT_RETRY_COUNT: 0,
    LOOP_DEFAULT_BACKOFF: 'fixed',
    LOOP_SANDBOX_TYPE: 'gvisor',
    LOOP_SANDBOX_URL: 'http://localhost:4000',
    LOOP_SANDBOX_MEMORY_MB: 256,
    LOOP_SANDBOX_CPU_SECONDS: 30,
    LOOP_SANDBOX_POOL_SIZE: 1,
    LOOP_LLM_PRIMARY: 'ollama',
    LOOP_LLM_OLLAMA_URL: 'http://localhost:11434',
    LOOP_LLM_FALLBACK_CHAIN: 'ollama',
    LOOP_JWT_SECRET: 'test-jwt-secret-for-tests-only-32ch',
    LOOP_JWT_ACCESS_TTL: '15m',
    LOOP_JWT_REFRESH_TTL: '7d',
    LOOP_EGRESS_DEFAULT_POLICY: 'deny',
    LOOP_AIRGAP_MODE: false,
    LOOP_METRICS_ENABLED: false,
    LOOP_OTEL_ENABLED: false,
  };

  const Fastify = (await import('fastify')).default;
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);

  // ── State store ─────────────────────────────────────────────────────────
  const conn = createSqliteConnection({ path: dbPath, wal: false });
  const store = new SqliteStateStore(conn);
  await store.initialise();

  // ── Seed system user ────────────────────────────────────────────────────
  // The HTTP routes hardcode `created_by: 'system'` / `updated_by: 'system'`
  // until real auth middleware lands, so seed a user whose *id* is literally
  // 'system' so foreign-key constraints resolve.
  await store.users.create({
    id: 'system',
    username: 'system',
    password_hash: 'test-hash',
    email: 'system@loop.test',
    role: 'admin',
  });

  // ── Connectors ──────────────────────────────────────────────────────────
  const connectors = new ConnectorRegistry();
  connectors.registerAdapter(new VaultAdapter());
  connectors.registerAdapter(new DeskAdapter());

  // ── Versioning + authoring ──────────────────────────────────────────────
  const gitBackend = new GitBackend({ repoPath: path.join(tmpDataDir, 'git') });
  await gitBackend.initialise();
  const versioning = new VersioningService(store, gitBackend);
  const authoring = new WorkflowAuthoringService(store, versioning);

  // ── Engine ──────────────────────────────────────────────────────────────
  const executor = new ExecutionExecutor(store, connectors, 10);

  // ── Triggers ────────────────────────────────────────────────────────────
  const triggerDispatcher = new TriggerDispatcher(store);
  const webhookHandler = new WebhookTriggerHandler(store);
  const manualHandler = new ManualTriggerHandler(store);

  // ── Egress + secrets ────────────────────────────────────────────────────
  const egressEngine = new EgressEngine(() => store.egressPolicies.listEnabled());
  const secretsManager = new SecretsManager(store, config.LOOP_ENCRYPTION_KEY);

  // ── Routes ──────────────────────────────────────────────────────────────
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
    config,
  });

  // Health endpoints
  app.get('/health', async () => ({ status: 'ok' }));

  return {
    app,
    store,
    conn,
    connectors,
    authoring,
    executor,
    webhookHandler,
    manualHandler,
    triggerDispatcher,
    egressEngine,
    secretsManager,
    config,
  };
}

/**
 * A minimal valid workflow definition — no nodes, no edges. Passes topology
 * validation (returns warnings but no errors).
 */
export const MINIMAL_DEFINITION: WorkflowDefinition = {
  version: '1.0',
  nodes: [],
  edges: [],
  variables: {},
  metadata: { name: 'test-workflow', description: 'Test workflow', tags: ['test'] },
};

/**
 * Three-node linear workflow: vault.search → transform → desk.create_task.
 * Used by e2e execution tests.
 */
export const THREE_NODE_DEFINITION: WorkflowDefinition = {
  version: '1.0',
  nodes: [
    {
      id: 'node_search',
      type: 'vault.search',
      position: { x: 0, y: 0 },
      config: { query: 'integration test' },
    },
    {
      id: 'node_transform',
      type: 'transform',
      position: { x: 200, y: 0 },
      config: { expression: 'upper' },
    },
    {
      id: 'node_task',
      type: 'desk.create_task',
      position: { x: 400, y: 0 },
      config: { title: 'Processed result' },
    },
  ],
  edges: [
    { id: 'e1', source: 'node_search', target: 'node_transform' },
    { id: 'e2', source: 'node_transform', target: 'node_task' },
  ],
  variables: {},
  metadata: { name: 'e2e-workflow', tags: ['e2e'] },
};

/**
 * Create a workflow via the test app's state store directly. Returns the
 * created workflow including its generated id.
 */
export async function seedWorkflow(
  store: TestApp['store'],
  overrides: Partial<{
    name: string;
    description: string;
    definition: WorkflowDefinition;
    tags: string[];
  }> = {},
) {
  return store.workflows.create({
    id: crypto.randomUUID(),
    name: overrides.name ?? 'Test Workflow',
    description: overrides.description ?? 'A test workflow',
    definition: overrides.definition ?? MINIMAL_DEFINITION,
    tags: overrides.tags ?? ['test'],
    created_by: SYSTEM_USER_ID,
  });
}
