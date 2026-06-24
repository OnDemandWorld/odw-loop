import type { ZodTypeAny } from 'zod';
import { typeRegistry } from './registry.js';

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
}

/** Validate an arbitrary value against a registered type by name. */
export function validateAgainstType(value: unknown, typeName: string): ValidationResult {
  const reg = typeRegistry.get(typeName);
  if (!reg) {
    return { valid: false, errors: [{ path: '', message: `Unknown type '${typeName}'` }] };
  }
  return validateWithSchema(value, reg.schema);
}

/** Validate a value against a Zod schema, returning a normalised result. */
export function validateWithSchema(value: unknown, schema: ZodTypeAny): ValidationResult {
  const result = schema.safeParse(value);
  if (result.success) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
