export { createLogger, correlationMixin } from './logger.js';
export type { LoopLogger, LoggerOptions } from './logger.js';
export {
  generateRequestId,
  runWithCorrelation,
  getCorrelationContext,
} from './correlation.js';
export type { CorrelationContext } from './correlation.js';
export { metricsRegistry, collectMetrics, renderMetrics } from './metrics.js';
// V1.6 M1 (F-2): distributed-tracing spans (span model + sampling + exporters).
export {
  startSpan,
  runInSpan,
  withSpan,
  configureTracing,
  getTracingConfig,
  resetTracing,
} from './tracing.js';
export type {
  Span,
  SpanData,
  SpanStatus,
  TracingConfig,
  TracingOverrides,
  TraceExporterKind,
} from './tracing.js';
export { ConsoleSpanExporter, OtlpHttpSpanExporter, toOtlpJson } from './exporters.js';
export type {
  SpanExporter,
  ConsoleSpanExporterOptions,
  OtlpHttpSpanExporterOptions,
} from './exporters.js';
