/**
 * V1.6 M1 (F-2, SP1): span model, AsyncLocalStorage parenting and sampling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  startSpan,
  runInSpan,
  withSpan,
  configureTracing,
  getTracingConfig,
  resetTracing,
  type SpanData,
  type SpanExporter,
} from '../../../packages/observability/src/index.js';
import { runWithCorrelation } from '../../../packages/observability/src/correlation.js';

function createCapturingExporter(): { exporter: SpanExporter; spans: SpanData[] } {
  const spans: SpanData[] = [];
  const exporter: SpanExporter = {
    export(span: SpanData): void {
      spans.push(span);
    },
  };
  return { exporter, spans };
}

const TRACE_ENV_VARS = ['TRACE_SAMPLE_RATE', 'TRACE_EXPORTER', 'OTLP_ENDPOINT'] as const;

beforeEach(() => {
  resetTracing();
  for (const key of TRACE_ENV_VARS) delete process.env[key];
});

afterEach(() => {
  resetTracing();
  for (const key of TRACE_ENV_VARS) delete process.env[key];
  vi.restoreAllMocks();
});

describe('Span model', () => {
  it('stamps ids, timestamps and status on start/end', () => {
    const { exporter, spans } = createCapturingExporter();
    configureTracing({ exporter });

    const span = startSpan('op', { 'k': 'v' });
    expect(span.sampled).toBe(true);
    expect(span.data.name).toBe('op');
    expect(span.data.span_id).toMatch(/^[0-9a-f]{16}$/);
    expect(span.data.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(span.data.parent_span_id).toBeUndefined();
    expect(span.data.status).toBe('unset');
    expect(span.data.duration_ms).toBeUndefined();

    span.end();
    expect(span.data.status).toBe('ok');
    expect(span.data.duration_ms).toBeGreaterThanOrEqual(0);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attrs).toEqual({ 'k': 'v' });
  });

  it('end() is idempotent — exported exactly once', () => {
    const { exporter, spans } = createCapturingExporter();
    configureTracing({ exporter });

    const span = startSpan('once');
    span.end();
    span.end('error'); // second call ignored
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status).toBe('ok');
  });

  it('explicit end status wins', () => {
    const { exporter, spans } = createCapturingExporter();
    configureTracing({ exporter });

    const span = startSpan('failing');
    span.end('error');
    expect(spans[0]?.status).toBe('error');
  });
});

describe('span tree / parenting (AsyncLocalStorage)', () => {
  it('auto-parents nested spans and shares one trace id', () => {
    const { exporter, spans } = createCapturingExporter();
    configureTracing({ exporter });

    const root = startSpan('root');
    runInSpan(root, () => {
      const child = startSpan('child');
      runInSpan(child, () => {
        startSpan('grandchild').end();
      });
      child.end();
    });
    root.end();

    expect(spans).toHaveLength(3);
    // Export order = end order: grandchild, child, root.
    const [grandchild, child, rootSpan] = spans as [SpanData, SpanData, SpanData];
    expect(rootSpan.parent_span_id).toBeUndefined();
    expect(child.parent_span_id).toBe(rootSpan.span_id);
    expect(grandchild.parent_span_id).toBe(child.span_id);
    expect(child.trace_id).toBe(rootSpan.trace_id);
    expect(grandchild.trace_id).toBe(rootSpan.trace_id);
  });

  it('parenting survives awaited async boundaries', async () => {
    const { exporter, spans } = createCapturingExporter();
    configureTracing({ exporter });

    await withSpan('parent', undefined, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      await withSpan('child', undefined, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
      });
    });

    expect(spans).toHaveLength(2);
    const child = spans.find((s) => s.name === 'child');
    const parent = spans.find((s) => s.name === 'parent');
    expect(child?.parent_span_id).toBe(parent?.span_id);
    expect(child?.status).toBe('ok');
    expect(parent?.status).toBe('ok');
  });

  it('spans started outside a context are independent roots', () => {
    const { exporter, spans } = createCapturingExporter();
    configureTracing({ exporter });

    startSpan('a').end();
    startSpan('b').end();

    expect(spans[0]?.parent_span_id).toBeUndefined();
    expect(spans[1]?.parent_span_id).toBeUndefined();
    expect(spans[0]?.trace_id).not.toBe(spans[1]?.trace_id);
  });

  it('withSpan marks the span error and re-throws unchanged', async () => {
    const { exporter, spans } = createCapturingExporter();
    configureTracing({ exporter });

    await expect(
      withSpan('failing', undefined, async () => {
        throw new Error('kaput');
      }),
    ).rejects.toThrow('kaput');

    expect(spans).toHaveLength(1);
    expect(spans[0]?.status).toBe('error');
    expect(spans[0]?.attrs?.['error.message']).toBe('Error: kaput');
  });

  it('reuses the V1.5 correlation trace_id at a root span', () => {
    const { exporter, spans } = createCapturingExporter();
    configureTracing({ exporter });

    runWithCorrelation({ request_id: 'r1', trace_id: 'trace-from-header' }, () => {
      startSpan('in-request').end();
    });

    expect(spans[0]?.trace_id).toBe('trace-from-header');
  });
});

describe('sampling', () => {
  it('sampleRate 0 produces no-op spans — not exported, no attrs, no duration', () => {
    const { exporter, spans } = createCapturingExporter();
    configureTracing({ sampleRate: 0, exporter });

    const span = startSpan('dropped', { 'k': 'v' });
    expect(span.sampled).toBe(false);
    span.setAttr('extra', 1);
    span.end();

    expect(spans).toHaveLength(0);
    expect(span.data.attrs).toBeUndefined();
    expect(span.data.duration_ms).toBeUndefined();
  });

  it('sampleRate 1 samples everything (default)', () => {
    const { exporter, spans } = createCapturingExporter();
    configureTracing({ exporter });

    startSpan('a').end();
    startSpan('b').end();
    expect(spans).toHaveLength(2);
  });

  it('children inherit the root sampling decision (trace-level consistency)', () => {
    const { exporter, spans } = createCapturingExporter();
    configureTracing({ sampleRate: 0.5, exporter });
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99); // root unsampled

    const root = startSpan('root');
    expect(root.sampled).toBe(false);

    let childSampled = true;
    runInSpan(root, () => {
      const child = startSpan('child');
      childSampled = child.sampled;
      child.end();
    });
    root.end();

    expect(childSampled).toBe(false); // inherited, not re-rolled
    expect(random).toHaveBeenCalledTimes(1); // only the root rolled the dice
    expect(spans).toHaveLength(0);

    random.mockReturnValue(0.01); // next root sampled
    const sampledRoot = startSpan('root2');
    expect(sampledRoot.sampled).toBe(true);
    expect(random).toHaveBeenCalledTimes(2);
    sampledRoot.end();
    expect(spans).toHaveLength(1);
  });
});

describe('configuration', () => {
  it('defaults: sampleRate 1.0, exporter console (backward compatible)', () => {
    const config = getTracingConfig();
    expect(config.sampleRate).toBe(1);
    expect(config.exporterKind).toBe('console');
    expect(config.otlpEndpoint).toBeUndefined();
  });

  it('reads TRACE_SAMPLE_RATE / TRACE_EXPORTER / OTLP_ENDPOINT from env', () => {
    process.env['TRACE_SAMPLE_RATE'] = '0.25';
    process.env['TRACE_EXPORTER'] = 'otlp';
    process.env['OTLP_ENDPOINT'] = 'http://otel.test:4318';

    const config = getTracingConfig();
    expect(config.sampleRate).toBe(0.25);
    expect(config.exporterKind).toBe('otlp');
    expect(config.otlpEndpoint).toBe('http://otel.test:4318');
  });

  it('clamps invalid sample rates and falls back on unknown exporters', () => {
    process.env['TRACE_SAMPLE_RATE'] = 'not-a-number';
    process.env['TRACE_EXPORTER'] = 'carrier-pigeon';
    const config = getTracingConfig();
    expect(config.sampleRate).toBe(1);
    expect(config.exporterKind).toBe('console');

    process.env['TRACE_SAMPLE_RATE'] = '7';
    expect(getTracingConfig().sampleRate).toBe(1);
    process.env['TRACE_SAMPLE_RATE'] = '-3';
    expect(getTracingConfig().sampleRate).toBe(0);
  });

  it('programmatic overrides win over env', () => {
    process.env['TRACE_SAMPLE_RATE'] = '0.1';
    configureTracing({ sampleRate: 0.9, exporterKind: 'none' });
    const config = getTracingConfig();
    expect(config.sampleRate).toBe(0.9);
    expect(config.exporterKind).toBe('none');
  });

  it('exporter none drops finished spans', () => {
    configureTracing({ exporterKind: 'none' });
    const span = startSpan('silent');
    expect(() => span.end()).not.toThrow();
  });
});
