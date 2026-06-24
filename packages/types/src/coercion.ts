/**
 * Type coercion rules — used by the engine when an edge connects two ports with
 * slightly different but compatible types (e.g. string → number, array → single item).
 */

export type CoercionFn = (value: unknown) => unknown;

const COERCIONS = new Map<string, CoercionFn>();

COERCIONS.set('string→number', (v) => Number(v));
COERCIONS.set('number→string', (v) => String(v));
COERCIONS.set('string→boolean', (v) => v === 'true' || v === '1');
COERCIONS.set('boolean→string', (v) => String(v));
COERCIONS.set('array→single', (v) => (Array.isArray(v) ? v[0] : v));
COERCIONS.set('single→array', (v) => (Array.isArray(v) ? v : [v]));

export function coerce(value: unknown, fromType: string, toType: string): unknown {
  if (fromType === toType) return value;
  const key = `${fromType}→${toType}`;
  const fn = COERCIONS.get(key);
  if (!fn) return value;
  try {
    return fn(value);
  } catch {
    return value;
  }
}

export function registerCoercion(from: string, to: string, fn: CoercionFn): void {
  COERCIONS.set(`${from}→${to}`, fn);
}
