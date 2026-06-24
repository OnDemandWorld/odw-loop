/**
 * Prometheus metrics for Loop (§16.1).
 *
 * Uses prom-client for metric definitions.  When prom-client is unavailable (e.g. in
 * lightweight test environments) the module falls back to a no-op registry so imports
 * never fail at load time.
 */
import { createLogger } from './logger.js';
const logger = createLogger({ name: 'loop:metrics', component: 'observability' });
let cached;
function tryLoadPromClient() {
    try {
        // Dynamic require to keep prom-client optional
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('prom-client');
    }
    catch {
        return undefined;
    }
}
/**
 * Build (or return cached) metrics registry.
 * If prom-client is not installed the returned object is a set of no-op stubs so
 * business code can call metrics unconditionally.
 */
export function metricsRegistry() {
    if (cached)
        return cached;
    const client = tryLoadPromClient();
    if (!client) {
        logger.debug('prom-client not available — metrics are no-op stubs');
        const noopCounter = () => ({ inc: () => { } });
        const noopHistogram = () => ({ observe: () => { } });
        const noopGauge = () => ({ set: () => { }, inc: () => { }, dec: () => { } });
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
    };
    return cached;
}
/** Render all metrics in Prometheus text format. */
export async function collectMetrics() {
    const client = tryLoadPromClient();
    if (!client)
        return '';
    return client.register.metrics();
}
/** Alias kept for convenience in HTTP route handlers. */
export const renderMetrics = collectMetrics;
//# sourceMappingURL=metrics.js.map