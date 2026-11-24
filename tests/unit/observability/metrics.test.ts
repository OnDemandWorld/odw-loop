/**
 * Unit tests — Prometheus metrics are real, not no-ops (audit #54).
 *
 * The package is ESM; a bare require('prom-client') threw ReferenceError and
 * the swallowed fallback made every metric a no-op and /metrics empty.
 */

import { describe, it, expect } from 'vitest';

import { metricsRegistry, collectMetrics } from '../../../packages/observability/src/metrics';

describe('metricsRegistry (audit #54)', () => {
  it('records real counters and renders them in Prometheus format', async () => {
    const m = metricsRegistry();
    m.executionsTotal.inc({ workflow_id: 'wf-metrics-test', status: 'succeeded' });
    const out = await collectMetrics();
    expect(out).toContain('loop_executions_total');
    expect(out).toContain('wf-metrics-test');
  });

  it('collectMetrics is non-empty when prom-client is installed', async () => {
    const out = await collectMetrics();
    expect(out.length).toBeGreaterThan(0);
  });
});
