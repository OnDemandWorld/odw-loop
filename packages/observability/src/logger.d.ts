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
export declare function createLogger(opts: LoggerOptions): LoopLogger;
//# sourceMappingURL=logger.d.ts.map