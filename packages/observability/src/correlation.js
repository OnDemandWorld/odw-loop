import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
const storage = new AsyncLocalStorage();
/** Generate a fresh request ID (UUIDv4). */
export function generateRequestId() {
    return randomUUID();
}
/** Run `fn` with a correlation context available to all downstream code. */
export function runWithCorrelation(ctx, fn) {
    return storage.run(ctx, fn);
}
/** Read the current correlation context (or undefined if outside a request). */
export function getCorrelationContext() {
    return storage.getStore();
}
//# sourceMappingURL=correlation.js.map