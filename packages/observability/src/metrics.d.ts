/**
 * Prometheus metrics for Loop (§16.1).
 *
 * Uses prom-client for metric definitions.  When prom-client is unavailable (e.g. in
 * lightweight test environments) the module falls back to a no-op registry so imports
 * never fail at load time.
 */
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
/**
 * Build (or return cached) metrics registry.
 * If prom-client is not installed the returned object is a set of no-op stubs so
 * business code can call metrics unconditionally.
 */
export declare function metricsRegistry(): LoopMetrics;
/** Render all metrics in Prometheus text format. */
export declare function collectMetrics(): Promise<string>;
/** Alias kept for convenience in HTTP route handlers. */
export declare const renderMetrics: typeof collectMetrics;
export {};
//# sourceMappingURL=metrics.d.ts.map