import pino from 'pino';
/**
 * Create a Pino-based structured JSON logger.
 * Log format matches TSD §12.3: JSON with level, time, pid, hostname, msg, and any
 * extra fields (execution_id, request_id, etc.) that callers bind via child loggers.
 */
export function createLogger(opts) {
    const level = opts.level ?? process.env['LOOP_LOG_LEVEL'] ?? 'info';
    const logger = pino({
        name: opts.name,
        level,
        base: opts.component ? { component: opts.component } : undefined,
        timestamp: pino.stdTimeFunctions.isoTime,
    });
    return logger;
}
//# sourceMappingURL=logger.js.map