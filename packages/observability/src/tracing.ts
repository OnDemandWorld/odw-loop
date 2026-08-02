/**
 * V1.6 M1 (F-2, SP1): lightweight distributed-tracing spans.
 *
 * Builds on the V1.5 `trace_id` propagation (correlation.ts) and adds a real
 * span model: `startSpan(name, attrs?)` / `span.end(status?)` with an
 * AsyncLocalStorage span stack so child spans started inside a parent's
 * context are auto-parented into a trace tree.
 *
 * - Sampling: `TRACE_SAMPLE_RATE` (0.0–1.0, default 1.0 = sample everything).
 *   The decision is made once per trace root and inherited by every child, so
 *   a trace is either fully sampled or fully dropped. Unsampled spans are
 *   no-ops: `setAttr`/`end` do nothing and nothing is exported.
 * - Export: finished sampled spans go to the configured `SpanExporter`
 *   (`TRACE_EXPORTER=console|otlp|none`, default console). Export is
 *   best-effort and can never throw into the caller.
 * - The active correlation context's `trace_id` (inbound `X-Trace-Id`) is
 *   reused as the span trace id when no parent span exists, so spans and V1.5
 *   structured logs share one trace id.
 *
 * Everything here is best-effort: tracing must never change execution results.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

import { createLogger } from './logger.js';
import { getCorrelationContext } from './correlation.js';
import { ConsoleSpanExporter, OtlpHttpSpanExporter, type SpanExporter } from './exporters.js';

const logger = createLogger({ name: 'loop:tracing', component: 'observability' });

// ─── Model ───────────────────────────────────────────────────────────────────

export type SpanStatus = 'unset' | 'ok' | 'error';

/** Finished-span record handed to exporters. */
export interface SpanData {
  name: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  start_ms: number;
  duration_ms?: number;
  attrs?: Record<string, unknown>;
  status: SpanStatus;
}

/** Live span handle returned by `startSpan`. */
export interface Span {
  /** The underlying record — mutated in place as the span progresses. */
  readonly data: SpanData;
  /** False for no-op spans dropped by sampling (or a `none` exporter). */
  readonly sampled: boolean;
  /** Attach a key/value attribute. No-op once ended or when unsampled. */
  setAttr(key: string, value: unknown): void;
  /**
   * Finish the span: stamps `duration_ms` + status (default `ok`) and exports
   * it. Idempotent — a second call is ignored.
   */
  end(status?: SpanStatus): void;
}

// ─── Configuration ───────────────────────────────────────────────────────────

export type TraceExporterKind = 'console' | 'otlp' | 'none';

export interface TracingConfig {
  sampleRate: number;
  exporterKind: TraceExporterKind;
  otlpEndpoint?: string;
}

/** Programmatic overrides (tests / embedders); merged over the env vars. */
export interface TracingOverrides {
  sampleRate?: number;
  exporterKind?: TraceExporterKind;
  otlpEndpoint?: string;
  /** Exporter instance override — wins over `exporterKind` (used by tests). */
  exporter?: SpanExporter;
}

let overrides: TracingOverrides = {};
let cachedExporterKey = '';
let cachedExporter: SpanExporter | undefined;

/** Merge programmatic overrides (shallow). */
export function configureTracing(next: TracingOverrides): void {
  overrides = { ...overrides, ...next };
}

/** Clear all overrides and the exporter cache (test hook). */
export function resetTracing(): void {
  overrides = {};
  cachedExporterKey = '';
  cachedExporter = undefined;
}

function parseSampleRate(raw: string | undefined): number {
  if (raw === undefined || raw.length === 0) return 1.0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 1.0;
  return Math.min(1, Math.max(0, parsed));
}

function parseExporterKind(raw: string | undefined): TraceExporterKind {
  if (raw === 'console' || raw === 'otlp' || raw === 'none') return raw;
  return 'console';
}

/** Resolve the effective config: overrides win, env vars fill the rest. */
export function getTracingConfig(): TracingConfig {
  const sampleRate =
    overrides.sampleRate ?? parseSampleRate(process.env['TRACE_SAMPLE_RATE']);
  const exporterKind = overrides.exporterKind ?? parseExporterKind(process.env['TRACE_EXPORTER']);
  const otlpEndpoint = overrides.otlpEndpoint ?? process.env['OTLP_ENDPOINT'];
  return {
    sampleRate,
    exporterKind,
    ...(otlpEndpoint !== undefined ? { otlpEndpoint } : {}),
  };
}

function resolveExporter(config: TracingConfig): SpanExporter | undefined {
  if (overrides.exporter !== undefined) return overrides.exporter;
  if (config.exporterKind === 'none') return undefined;
  const key = `${config.exporterKind}:${config.otlpEndpoint ?? ''}`;
  if (key === cachedExporterKey && cachedExporter !== undefined) return cachedExporter;
  const exporter: SpanExporter =
    config.exporterKind === 'otlp'
      ? new OtlpHttpSpanExporter({ endpoint: config.otlpEndpoint ?? 'http://localhost:4318' })
      : new ConsoleSpanExporter();
  cachedExporterKey = key;
  cachedExporter = exporter;
  return exporter;
}

// ─── Span stack (AsyncLocalStorage) ─────────────────────────────────────────

interface SpanContext {
  data: SpanData;
  sampled: boolean;
}

const spanStorage = new AsyncLocalStorage<SpanContext>();
const contextBySpan = new WeakMap<Span, SpanContext>();

/**
 * Trace-level sampling: a child inherits its parent's decision so a trace is
 * never partially sampled; a root decides by `Math.random() < rate`.
 */
function decideSampling(parent: SpanContext | undefined, rate: number): boolean {
  if (parent !== undefined) return parent.sampled;
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}

/**
 * Start a span. When called inside an active span context (see `runInSpan` /
 * `withSpan`) the new span is parented to it and shares its trace id; at a
 * root, the V1.5 correlation `trace_id` is reused when present.
 */
export function startSpan(name: string, attrs?: Record<string, unknown>): Span {
  const config = getTracingConfig();
  const parent = spanStorage.getStore();
  const sampled = decideSampling(parent, config.sampleRate);
  const correlation = getCorrelationContext();
  const traceId = parent?.data.trace_id ?? correlation?.trace_id ?? randomBytes(16).toString('hex');

  const data: SpanData = {
    name,
    trace_id: traceId,
    span_id: randomBytes(8).toString('hex'),
    ...(parent !== undefined ? { parent_span_id: parent.data.span_id } : {}),
    start_ms: Date.now(),
    status: 'unset',
  };
  // Unsampled spans are true no-ops: they record nothing (attrs included).
  if (sampled && attrs !== undefined && Object.keys(attrs).length > 0) {
    data.attrs = { ...attrs };
  }

  const context: SpanContext = { data, sampled };
  let ended = false;

  const span: Span = {
    data,
    sampled,
    setAttr(key: string, value: unknown): void {
      if (!sampled || ended) return;
      data.attrs = { ...(data.attrs ?? {}), [key]: value };
    },
    end(status?: SpanStatus): void {
      if (ended) return;
      ended = true;
      if (!sampled) return; // no-op span — nothing to stamp, nothing to export
      data.duration_ms = Date.now() - data.start_ms;
      if (status !== undefined) {
        data.status = status;
      } else if (data.status === 'unset') {
        data.status = 'ok';
      }
      exportSpan(data);
    },
  };

  contextBySpan.set(span, context);
  return span;
}

/** Best-effort export — swallows everything so tracing never breaks callers. */
function exportSpan(data: SpanData): void {
  try {
    const exporter = resolveExporter(getTracingConfig());
    exporter?.export(data);
  } catch (err) {
    logger.debug({ error: String(err) }, 'Span export failed — degraded');
  }
}

/**
 * Run `fn` with `span` as the active span: any span started while `fn` runs
 * (including across awaited promises) is parented to it.
 */
export function runInSpan<T>(span: Span, fn: () => T): T {
  const context = contextBySpan.get(span);
  if (context === undefined) return fn();
  return spanStorage.run(context, fn);
}

/**
 * Start a span, run the async `fn` inside its context, and end the span
 * automatically — `ok` on resolve, `error` (plus `error.message` attr) on
 * reject. The outcome is always re-thrown unchanged.
 */
export async function withSpan<T>(
  name: string,
  attrs: Record<string, unknown> | undefined,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = startSpan(name, attrs);
  try {
    const result = await runInSpan(span, () => fn(span));
    span.end();
    return result;
  } catch (err) {
    span.setAttr('error.message', String(err));
    span.end('error');
    throw err;
  }
}
