import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface CorrelationContext {
  request_id: string;
  execution_id?: string;
  node_execution_id?: string;
  trace_id?: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

/** Generate a fresh request ID (UUIDv4). */
export function generateRequestId(): string {
  return randomUUID();
}

/** Run `fn` with a correlation context available to all downstream code. */
export function runWithCorrelation<T>(ctx: CorrelationContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Read the current correlation context (or undefined if outside a request). */
export function getCorrelationContext(): CorrelationContext | undefined {
  return storage.getStore();
}
