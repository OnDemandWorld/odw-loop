import pino from 'pino';
import { getCorrelationContext } from './correlation.js';

/**
 * V1.5 M1 (F-3, TR1): pino mixin that injects the active correlation context
 * (trace_id, request_id) into every structured log line. Best-effort — when no
 * context is active (e.g. background work outside a request) it adds nothing, so
 * existing log output is unchanged. This is what makes a single `trace_id`
 * correlate every log emitted while handling a traced request.
 */
export function correlationMixin(): Record<string, unknown> {
  const ctx = getCorrelationContext();
  if (ctx === undefined) return {};
  const fields: Record<string, unknown> = {};
  if (ctx.trace_id !== undefined) fields['trace_id'] = ctx.trace_id;
  if (ctx.request_id !== undefined) fields['request_id'] = ctx.request_id;
  return fields;
}

export interface LoopLogger {
  info(obj: unknown, msg?: string): void;
  info(msg: string): void;
  warn(obj: unknown, msg?: string): void;
  warn(msg: string): void;
  error(obj: unknown, msg?: string): void;
  error(msg: string): void;
  debug(obj: unknown, msg?: string): void;
  debug(msg: string): void;
  fatal(obj: unknown, msg?: string): void;
  fatal(msg: string): void;
  trace(obj: unknown, msg?: string): void;
  trace(msg: string): void;
  child(bindings: Record<string, unknown>): LoopLogger;
}

export interface LoggerOptions {
  name: string;
  level?: string;
  component?: string;
}

/**
 * Create a Pino-based structured JSON logger.
 * Log format matches TSD §12.3: JSON with level, time, pid, hostname, msg, and any
 * extra fields (execution_id, request_id, etc.) that callers bind via child loggers.
 */
export function createLogger(opts: LoggerOptions): LoopLogger {
  const level = opts.level ?? process.env['LOOP_LOG_LEVEL'] ?? 'info';
  const logger = (pino as unknown as (opts: Record<string, unknown>) => LoopLogger)({
    name: opts.name,
    level,
    base: opts.component ? { component: opts.component } : undefined,
    // V1.5 M1 (F-3, TR1): inject trace_id/request_id from the active correlation
    // context into every log line (best-effort, no-op outside a request).
    mixin: correlationMixin,
  });
  return logger;
}
