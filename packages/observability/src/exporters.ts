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
}

/**
 * Best-effort OTLP/HTTP JSON exporter. Each `export()` fires a POST to
 * `<endpoint>/v1/traces` and forgets it: network errors, non-2xx responses and
 * timeouts all degrade to a debug log. Spans are encoded in the OTLP JSON
 * representation (resourceSpans → scopeSpans → spans).
 */
export class OtlpHttpSpanExporter implements SpanExporter {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OtlpHttpSpanExporterOptions) {
    this.url = `${options.endpoint.replace(/\/+$/, '')}/v1/traces`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 2000;
  }

  export(span: SpanData): void {
    const body = JSON.stringify(toOtlpJson(span));
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    void this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    })
      .catch((err: unknown) => {
        logger.debug({ error: String(err), url: this.url }, 'OTLP span export failed — degraded');
      })
      .finally(() => {
        clearTimeout(timer);
      });
  }
}

// ─── OTLP JSON encoding ──────────────────────────────────────────────────────

/** Normalise an arbitrary trace id (UUID or hex) to 32 lowercase hex chars. */
function toHex32(id: string): string {
  const hex = id.replace(/[^0-9a-fA-F]/g, '').toLowerCase().slice(0, 32);
  return hex.padEnd(32, '0');
}

function toOtlpAnyValue(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: JSON.stringify(value) ?? String(value) };
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
