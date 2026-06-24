export interface CorrelationContext {
    request_id: string;
    execution_id?: string;
    node_execution_id?: string;
    trace_id?: string;
}
/** Generate a fresh request ID (UUIDv4). */
export declare function generateRequestId(): string;
/** Run `fn` with a correlation context available to all downstream code. */
export declare function runWithCorrelation<T>(ctx: CorrelationContext, fn: () => T): T;
/** Read the current correlation context (or undefined if outside a request). */
export declare function getCorrelationContext(): CorrelationContext | undefined;
//# sourceMappingURL=correlation.d.ts.map