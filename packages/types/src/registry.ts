import type { ZodTypeAny } from 'zod';

/** A registered semantic type. */
export interface TypeRegistration {
  name: string;
  schema: ZodTypeAny;
  description?: string;
}

/**
 * Type registry — central catalogue of semantic types used for port compatibility.
 * Connectors register their custom types here so the authoring UI and engine can
 * validate source→target compatibility at edge creation time.
 */
export class TypeRegistry {
  private types = new Map<string, TypeRegistration>();

  register(reg: TypeRegistration): void {
    this.types.set(reg.name, reg);
  }

  get(name: string): TypeRegistration | undefined {
    return this.types.get(name);
  }

  list(): TypeRegistration[] {
    return [...this.types.values()];
  }

  has(name: string): boolean {
    return this.types.has(name);
  }

  /** Check whether a source output type is compatible with a target input type. */
  isCompatible(sourceType: string, targetType: string): boolean {
    if (sourceType === targetType) return true;
    if (targetType === 'any' || sourceType === 'any') return true;
    // Numeric coercion: number accepts integer and visa-versa
    const numeric = new Set(['number', 'integer', 'float']);
    if (numeric.has(sourceType) && numeric.has(targetType)) return true;
    return false;
  }
}

/** Singleton registry shared across the process. */
export const typeRegistry = new TypeRegistry();
