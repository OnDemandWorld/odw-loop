/**
 * V1.6 M1 (F-2, SP2): span exporters.
 *
 * Two best-effort sinks for finished spans:
 *  - `ConsoleSpanExporter` — the default; writes one structured log line per
 *    span (injectable sink for tests).
 *  - `OtlpHttpSpanExporter` — fire-and-forget OTLP/HTTP JSON POST to
 *    `OTLP_ENDPOINT`; failures degrade silently to a debug log and can never
 *    break the caller.
 *
 * Exporters never throw and never block the caller — tracing is observability,
 * not business logic.
 */

import { createHash } from 'node:crypto';

import { createLogger } from './logger.js';
import type { SpanData } from './tracing.js';

const logger = createLogger({ name: 'loop:tracing:exporter', component: 'observability' });

/** A sink for finished spans. Must not throw; must not block. */
export interface SpanExporter {
  export(span: SpanData): void;
}

// ─── Console ─────────────────────────────────────────────────────────────────

export interface ConsoleSpanExporterOptions {
  /** Receives each finished span; defaults to a structured pino log line. */
  sink?: (span: SpanData) => void;
}

/** Default exporter — emits one structured log line per finished span. */
export class ConsoleSpanExporter implements SpanExporter {
  private readonly sink: (span: SpanData) => void;

  constructor(options: ConsoleSpanExporterOptions = {}) {
    this.sink =
      options.sink ??
      ((span: SpanData): void => {
        logger.info({ span }, 'trace span');
      });
  }

  export(span: SpanData): void {
    try {
      this.sink(span);
    } catch {
      // best-effort — a broken sink must never surface to the caller.
    }
  }
}

// ─── OTLP/HTTP ───────────────────────────────────────────────────────────────

export interface OtlpHttpSpanExporterOptions {
  /** OTLP HTTP collector base URL, e.g. `http://otel:4318`. */
  endpoint: string;
  /** Injectable fetch implementation (tests). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Abort budget per export (default 2000ms) — exports must not hang. */
  timeoutMs?: number;
  /** Spans per POST (default 50). Audit #53. */
  batchSize?: number;
  /** Flush interval when the batch isn't full (default 1000ms). Audit #53. */
  flushIntervalMs?: number;
  /** Queue cap; oldest spans drop on overflow (default 1000). Audit #53. */
  maxQueue?: number;
  /** Audit #128: egress policy check applied before exporting to the
   *  collector — span attrs can carry customer-data fragments. */
  egress?: { check(url: string): Promise<void> };
}

/**
 * Best-effort OTLP/HTTP JSON exporter. Audit #53: spans are buffered and
 * flushed in batches (size or interval) with a bounded queue and a single
 * in-flight POST — a slow collector can no longer accumulate unbounded
 * per-span fetches. Network errors, non-2xx responses and timeouts degrade
 * to a debug log. Audit #129: serialization is circular/BigInt-safe.
 */
export class OtlpHttpSpanExporter implements SpanExporter {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly batchSize: number;
  private readonly maxQueue: number;
  private readonly egress?: { check(url: string): Promise<void> };
  private queue: SpanData[] = [];
  private flushing = false;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(options: OtlpHttpSpanExporterOptions) {
    this.url = `${options.endpoint.replace(/\/+$/, '')}/v1/traces`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.batchSize = options.batchSize ?? 50;
    this.maxQueue = options.maxQueue ?? 1000;
    this.egress = options.egress;
    this.timer = setInterval(() => void this.flush(), options.flushIntervalMs ?? 1000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  export(span: SpanData): void {
    this.queue.push(span);
    // Bounded queue: drop oldest on overflow rather than growing without limit.
    if (this.queue.length > this.maxQueue) {
      this.queue.splice(0, this.queue.length - this.maxQueue);
    }
    if (this.queue.length >= this.batchSize) void this.flush();
  }

  /** Flush pending spans in one batched POST. Never throws. */
  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, this.batchSize);
    try {
      // Audit #128: the collector URL is subject to egress policy like any
      // other outbound call (airgap / deny policies block the export).
      if (this.egress) {
        try {
          await this.egress.check(this.url);
        } catch (err) {
          logger.debug({ error: String(err), url: this.url }, 'OTLP export blocked by egress policy — spans dropped');
          return;
        }
      }
      const resourceSpans = batch.flatMap((s) => (toOtlpJson(s)['resourceSpans'] as unknown[]) ?? []);
      const body = safeStringify({ resourceSpans });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: controller.signal,
        });
        // Release the connection without buffering the collector's reply.
        void res.body?.cancel().catch(() => {});
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      logger.debug({ error: String(err), url: this.url }, 'OTLP span export failed — degraded');
    } finally {
      this.flushing = false;
      if (this.queue.length >= this.batchSize) void this.flush();
    }
  }

  /** Stop the flush timer (shutdown/tests). */
  close(): void {
    clearInterval(this.timer);
  }
}

// ─── OTLP JSON encoding ──────────────────────────────────────────────────────

/**
 * Normalise an arbitrary trace id (UUID or hex) to 32 lowercase hex chars.
 * Audit #130: ids that aren't 32 hex chars are HASHED, not zero-padded —
 * padding collapsed every non-hex id ('zzz', 'qqq') to the same all-zero
 * trace id, merging unrelated traces in the collector.
 */
function toHex32(id: string): string {
  const hex = id.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length >= 32) return hex.slice(0, 32);
  return createHash('sha256').update(id).digest('hex').slice(0, 32);
}

/** Audit #129: JSON.stringify that survives circular refs and BigInt. */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return (
    JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === 'bigint') return v.toString();
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    }) ?? String(value)
  );
}

/** Cap attribute string length — upstream error bodies can carry customer
 *  data fragments (audit #128); keep exports bounded and redact the tail. */
const MAX_ATTR_STRING = 1024;

function toOtlpAnyValue(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return { stringValue: value.length > MAX_ATTR_STRING ? `${value.slice(0, MAX_ATTR_STRING)}…[truncated]` : value };
  }
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: safeStringify(value) };
}

/** Encode a span as an OTLP/HTTP JSON payload (single-span batch). */
export function toOtlpJson(span: SpanData): Record<string, unknown> {
  const startNano = String(BigInt(span.start_ms) * 1_000_000n);
  const endNano = String(BigInt(span.start_ms + (span.duration_ms ?? 0)) * 1_000_000n);
  const attributes = Object.entries(span.attrs ?? {}).map(([key, value]) => ({
    key,
    value: toOtlpAnyValue(value),
  }));
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'odw-loop' } }],
        },
        scopeSpans: [
          {
            scope: { name: '@loop/observability' },
            spans: [
              {
                traceId: toHex32(span.trace_id),
                spanId: span.span_id,
                ...(span.parent_span_id !== undefined ? { parentSpanId: span.parent_span_id } : {}),
                name: span.name,
                kind: 1, // SPAN_KIND_INTERNAL
                startTimeUnixNano: startNano,
                endTimeUnixNano: endNano,
                attributes,
                status: { code: span.status === 'error' ? 2 : 1 },
              },
            ],
          },
        ],
      },
    ],
  };
}
