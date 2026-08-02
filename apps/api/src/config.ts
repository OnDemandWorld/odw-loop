/**
 * Centralised configuration loader — validates all LOOP_* env vars via Zod (§10).
 */

import { z } from 'zod';

/**
 * Correct boolean env-var parser. `z.coerce.boolean()` uses `Boolean(value)`,
 * which treats ANY non-empty string (including "false"/"0") as `true` — a
 * well-known Zod footgun that made e.g. `LOOP_REQUIRE_AUTH=false` enable auth.
 * This helper parses the conventional truthy strings ("true"/"1"/"yes"/"on")
 * as true and everything else (incl. "false"/"0"/"no"/"off"/"") as false,
 * falling back to `def` when the variable is unset.
 */
const booleanEnv = (def: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return def;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'on';
  }, z.boolean());

const configSchema = z.object({
  // §10.1 Core
  LOOP_PORT: z.coerce.number().default(3000),
  LOOP_HOST: z.string().default('0.0.0.0'),
  // Per-IP API rate limit. Self-hosted deployments often serve many users from
  // a shared IP (NAT/office/team server), so the default is generous and fully
  // configurable; set LOOP_RATE_LIMIT_MAX=0 to disable.
  LOOP_RATE_LIMIT_MAX: z.coerce.number().default(1000),
  LOOP_RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  LOOP_LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOOP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOOP_DATA_DIR: z.string().default('./data'),
  LOOP_ENCRYPTION_KEY: z.string().min(32).default('dev-key-change-me-please-32chars!'),

  // §10.2 Database
  LOOP_DB_TYPE: z.enum(['sqlite', 'postgres']).default('sqlite'),
  LOOP_DB_PATH: z.string().default('./data/loop.db'),
  LOOP_DB_HOST: z.string().optional(),
  LOOP_DB_PORT: z.coerce.number().optional(),
  LOOP_DB_NAME: z.string().optional(),
  LOOP_DB_USER: z.string().optional(),
  LOOP_DB_PASSWORD: z.string().optional(),
  LOOP_DB_SSL: booleanEnv(false),

  // §10.3 Redis (Scale)
  LOOP_REDIS_URL: z.string().optional(),
  LOOP_REDIS_PASSWORD: z.string().optional(),

  // §10.4 Execution engine
  LOOP_MAX_CONCURRENT: z.coerce.number().default(50),
  LOOP_EXECUTION_TIMEOUT_MS: z.coerce.number().default(300_000),
  LOOP_NODE_TIMEOUT_MS: z.coerce.number().default(30_000),
  // V1.1 M1 (F3): workflow-level timeout — bounds an entire execute() run.
  // Falls back to 300s; a per-workflow definition.settings.workflow_timeout_ms
  // overrides this when present.
  LOOP_WORKFLOW_TIMEOUT_MS: z.coerce.number().default(300_000),
  // V1.4 M2 (F-2): size cap (bytes) for the node output persisted into a
  // `node_succeeded` event payload. Oversized outputs are stored as a truncated
  // marker `{__truncated__, size, preview}` so large outputs cannot bloat the
  // append-only execution_events table.
  LOOP_EVENT_OUTPUT_MAX_BYTES: z.coerce.number().default(65_536),
  LOOP_DEFAULT_RETRY_COUNT: z.coerce.number().default(3),
  LOOP_DEFAULT_BACKOFF: z.enum(['exponential', 'linear', 'fixed']).default('exponential'),

  // §10.5 Sandbox
  LOOP_SANDBOX_TYPE: z.enum(['gvisor', 'firecracker']).default('gvisor'),
  LOOP_SANDBOX_URL: z.string().default('http://localhost:4000'),
  LOOP_SANDBOX_MEMORY_MB: z.coerce.number().default(256),
  LOOP_SANDBOX_CPU_SECONDS: z.coerce.number().default(30),
  LOOP_SANDBOX_POOL_SIZE: z.coerce.number().default(3),

  // §10.6 LLM providers
  LOOP_LLM_PRIMARY: z.string().default('ollama'),
  LOOP_LLM_OLLAMA_URL: z.string().default('http://localhost:11434'),
  LOOP_LLM_OPENAI_KEY: z.string().optional(),
  LOOP_LLM_ANTHROPIC_KEY: z.string().optional(),
  LOOP_LLM_FALLBACK_CHAIN: z.string().default('ollama,openai,anthropic'),

  // §10.7 ODW agents
  LOOP_VAULT_URL: z.string().optional(),
  LOOP_VAULT_API_KEY: z.string().optional(),
  LOOP_DESK_URL: z.string().optional(),
  LOOP_DESK_API_KEY: z.string().optional(),
  LOOP_RECAP_URL: z.string().optional(),
  LOOP_RECAP_API_KEY: z.string().optional(),

  // §10.8 Auth
  LOOP_JWT_SECRET: z.string().default('dev-jwt-secret-change-me'),
  LOOP_JWT_ACCESS_TTL: z.string().default('15m'),
  LOOP_JWT_REFRESH_TTL: z.string().default('7d'),
  // When true, /api/v1/* routes require a valid API key or JWT. Defaults to
  // false (open) for backward compatibility — health/ready/metrics/webhooks are
  // always public regardless of this flag.
  LOOP_REQUIRE_AUTH: booleanEnv(false),
  // Static API key accepted via `Authorization: Bearer <key>` or `x-api-key`.
  // Optional: when unset, only JWT bearer tokens authenticate.
  LOOP_API_KEY: z.string().optional(),
  // V1.3 (F-RBAC-Loop): RBAC role mapped to a valid static API key. JWT callers
  // get their role from the `role`/`roles` claim instead. Defaults to `admin`
  // so single-user/dev setups with a static key keep full access.
  LOOP_API_KEY_ROLE: z.enum(['admin', 'editor', 'viewer']).default('admin'),

  // §10.9 Egress
  LOOP_EGRESS_DEFAULT_POLICY: z.enum(['allow', 'deny']).default('deny'),
  LOOP_AIRGAP_MODE: booleanEnv(false),

  // §10.10 Observability
  LOOP_METRICS_ENABLED: booleanEnv(true),
  LOOP_OTEL_ENABLED: booleanEnv(false),
  LOOP_OTEL_ENDPOINT: z.string().optional(),
});

export type LoopConfig = z.infer<typeof configSchema>;

export function loadConfig(): LoopConfig {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid configuration:', result.error.format());
    process.exit(1);
  }
  return result.data;
}
