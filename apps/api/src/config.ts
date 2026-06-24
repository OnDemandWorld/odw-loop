/**
 * Centralised configuration loader — validates all LOOP_* env vars via Zod (§10).
 */

import { z } from 'zod';

const configSchema = z.object({
  // §10.1 Core
  LOOP_PORT: z.coerce.number().default(3000),
  LOOP_HOST: z.string().default('0.0.0.0'),
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
  LOOP_DB_SSL: z.coerce.boolean().default(false),

  // §10.3 Redis (Scale)
  LOOP_REDIS_URL: z.string().optional(),
  LOOP_REDIS_PASSWORD: z.string().optional(),

  // §10.4 Execution engine
  LOOP_MAX_CONCURRENT: z.coerce.number().default(50),
  LOOP_EXECUTION_TIMEOUT_MS: z.coerce.number().default(300_000),
  LOOP_NODE_TIMEOUT_MS: z.coerce.number().default(30_000),
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

  // §10.9 Egress
  LOOP_EGRESS_DEFAULT_POLICY: z.enum(['allow', 'deny']).default('deny'),
  LOOP_AIRGAP_MODE: z.coerce.boolean().default(false),

  // §10.10 Observability
  LOOP_METRICS_ENABLED: z.coerce.boolean().default(true),
  LOOP_OTEL_ENABLED: z.coerce.boolean().default(false),
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
