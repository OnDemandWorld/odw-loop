/**
 * Prometheus metrics for Loop (§16.1).
 *
 * Uses prom-client for metric definitions.  When prom-client is unavailable (e.g. in
 * lightweight test environments) the module falls back to a no-op registry so imports
 * never fail at load time.
 */

import { createLogger } from './logger.js';

const logger = createLogger({ name: 'loop:metrics', component: 'observability' });

// ──────────────────────────────────────────────────────────────────────────────
// prom-client types (loaded dynamically so the package stays optional at runtime)
// ──────────────────────────────────────────────────────────────────────────────

type Counter<T extends string = string> = {
  inc(labels?: Record<T, string | number>, value?: number): void;
  inc(value?: number): void;
};
type Histogram<T extends string = string> = {
  observe(labels: Record<T, string | number>, value: number): void;
  observe(value: number): void;
};
type Gauge<T extends string = string> = {
  set(labels: Record<T, string | number>, value: number): void;
  set(value: number): void;
  inc(labels?: Record<T, string | number>, value?: number): void;
  dec(labels?: Record<T, string | number>, value?: number): void;
};

export interface LoopMetrics {
  executionsTotal: Counter<'workflow_id' | 'status'>;
  executionDuration: Histogram<'workflow_id'>;
  nodeDuration: Histogram<'node_type' | 'workflow_id'>;
  nodeErrorsTotal: Counter<'node_type' | 'error_type'>;
  connectorCallsTotal: Counter<'connector_type' | 'status'>;
  connectorLatency: Histogram<'connector_type'>;
  triggerFiresTotal: Counter<'trigger_type' | 'workflow_id'>;
  sandboxExecutionsTotal: Counter<'status'>;
  sandboxDuration: Histogram<never>;
  circuitBreakerState: Gauge<'connector_type'>;
  activeExecutions: Gauge<never>;
  egressBlockedTotal: Counter<'domain'>;
  webhookReceivedTotal: Counter<'trigger_id' | 'status'>;
  apiRequestsTotal: Counter<'method' | 'route' | 'status_code'>;
  apiRequestDuration: Histogram<'method' | 'route'>;
}

let cached: LoopMetrics | undefined;

function tryLoadPromClient(): unknown {
  try {
    // Dynamic require to keep prom-client optional
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('prom-client');
  } catch {
    return undefined;
  }
}

/**
 * Build (or return cached) metrics registry.
 * If prom-client is not installed the returned object is a set of no-op stubs so
 * business code can call metrics unconditionally.
 */
export function metricsRegistry(): LoopMetrics {
  if (cached) return cached;

  const client = tryLoadPromClient() as
    | {
        Counter: new (cfg: {
          name: string;
          help: string;
          labelNames: string[];
        }) => Counter<string>;
        Histogram: new (cfg: {
          name: string;
          help: string;
          labelNames: string[];
          buckets?: number[];
        }) => Histogram<string>;
        Gauge: new (cfg: {
          name: string;
          help: string;
          labelNames: string[];
        }) => Gauge<string>;
        register: { metrics(): Promise<string> };
      }
    | undefined;

  if (!client) {
    logger.debug('prom-client not available — metrics are no-op stubs');
    const noopCounter = () =>
      ({ inc: () => {} }) as unknown as Counter<string>;
    const noopHistogram = () =>
      ({ observe: () => {} }) as unknown as Histogram<string>;
    const noopGauge = () =>
      ({ set: () => {}, inc: () => {}, dec: () => {} }) as unknown as Gauge<string>;
    cached = {
      executionsTotal: noopCounter(),
      executionDuration: noopHistogram(),
      nodeDuration: noopHistogram(),
      nodeErrorsTotal: noopCounter(),
      connectorCallsTotal: noopCounter(),
      connectorLatency: noopHistogram(),
      triggerFiresTotal: noopCounter(),
      sandboxExecutionsTotal: noopCounter(),
      sandboxDuration: noopHistogram(),
      circuitBreakerState: noopGauge(),
      activeExecutions: noopGauge(),
      egressBlockedTotal: noopCounter(),
      webhookReceivedTotal: noopCounter(),
      apiRequestsTotal: noopCounter(),
      apiRequestDuration: noopHistogram(),
    };
    return cached;
  }

  cached = {
    executionsTotal: new client.Counter({
      name: 'loop_executions_total',
      help: 'Total workflow executions',
      labelNames: ['workflow_id', 'status'],
    }),
    executionDuration: new client.Histogram({
      name: 'loop_execution_duration_seconds',
      help: 'Execution duration',
      labelNames: ['workflow_id'],
      buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
    }),
    nodeDuration: new client.Histogram({
      name: 'loop_node_duration_seconds',
      help: 'Per-node execution duration',
      labelNames: ['node_type', 'workflow_id'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30],
    }),
    nodeErrorsTotal: new client.Counter({
      name: 'loop_node_errors_total',
      help: 'Node execution errors',
      labelNames: ['node_type', 'error_type'],
    }),
    connectorCallsTotal: new client.Counter({
      name: 'loop_connector_calls_total',
      help: 'Connector API calls',
      labelNames: ['connector_type', 'status'],
    }),
    connectorLatency: new client.Histogram({
      name: 'loop_connector_latency_seconds',
      help: 'Connector call latency',
      labelNames: ['connector_type'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    }),
    triggerFiresTotal: new client.Counter({
      name: 'loop_trigger_fires_total',
      help: 'Trigger fires',
      labelNames: ['trigger_type', 'workflow_id'],
    }),
    sandboxExecutionsTotal: new client.Counter({
      name: 'loop_sandbox_executions_total',
      help: 'Sandbox code executions',
      labelNames: ['status'],
    }),
    sandboxDuration: new client.Histogram({
      name: 'loop_sandbox_duration_seconds',
      help: 'Sandbox execution duration',
      labelNames: [],
      buckets: [0.05, 0.1, 0.5, 1, 5, 10, 30],
    }),
    circuitBreakerState: new client.Gauge({
      name: 'loop_circuit_breaker_state',
      help: 'Circuit breaker state (0=closed,1=open,2=half_open)',
      labelNames: ['connector_type'],
    }),
    activeExecutions: new client.Gauge({
      name: 'loop_active_executions',
      help: 'Currently running executions',
      labelNames: [],
    }),
    egressBlockedTotal: new client.Counter({
      name: 'loop_egress_blocked_total',
      help: 'Egress requests blocked by policy',
      labelNames: ['domain'],
    }),
    webhookReceivedTotal: new client.Counter({
      name: 'loop_webhook_received_total',
      help: 'Webhooks received',
      labelNames: ['trigger_id', 'status'],
    }),
    apiRequestsTotal: new client.Counter({
      name: 'loop_api_requests_total',
      help: 'HTTP API requests',
      labelNames: ['method', 'route', 'status_code'],
    }),
    apiRequestDuration: new client.Histogram({
      name: 'loop_api_request_duration_seconds',
      help: 'API request duration',
      labelNames: ['method', 'route'],
      buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    }),
  } as unknown as LoopMetrics;

  return cached;
}

/** Render all metrics in Prometheus text format. */
export async function collectMetrics(): Promise<string> {
  const client = tryLoadPromClient() as { register: { metrics(): Promise<string> } } | undefined;
  if (!client) return '';
  return client.register.metrics();
}

/** Alias kept for convenience in HTTP route handlers. */
export const renderMetrics = collectMetrics;
