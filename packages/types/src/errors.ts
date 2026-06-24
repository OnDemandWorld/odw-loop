/**
 * Custom error hierarchy for Loop.
 * Every error carries a machine-readable `code` and an optional `details` payload
 * that maps to the standard API error envelope (§12.1).
 */

export type ErrorCode =
  // Validation 400
  | 'VALIDATION_REQUIRED'
  | 'VALIDATION_TYPE_MISMATCH'
  | 'VALIDATION_RANGE'
  | 'VALIDATION_TOPOLOGY'
  // Auth 401
  | 'AUTH_INVALID_TOKEN'
  | 'AUTH_EXPIRED'
  | 'AUTH_MISSING'
  // AuthZ 403
  | 'FORBIDDEN_INSUFFICIENT_ROLE'
  // Not found 404
  | 'NOT_FOUND_WORKFLOW'
  | 'NOT_FOUND_EXECUTION'
  | 'NOT_FOUND_TRIGGER'
  | 'NOT_FOUND_CONNECTOR'
  | 'NOT_FOUND_USER'
  | 'NOT_FOUND_SECRET'
  // Conflict 409
  | 'CONFLICT_VERSION'
  | 'CONFLICT_DUPLICATE'
  // Rate limit 429
  | 'RATE_LIMIT_EXCEEDED'
  // System 500
  | 'INTERNAL_DB_ERROR'
  | 'INTERNAL_SANDBOX_ERROR'
  // Upstream 502/503
  | 'UPSTREAM_VAULT_UNAVAILABLE'
  | 'UPSTREAM_DESK_UNAVAILABLE'
  | 'UPSTREAM_RECAP_UNAVAILABLE'
  | 'UPSTREAM_LLM_TIMEOUT'
  | 'UPSTREAM_LLM_UNAVAILABLE'
  // Node execution (in-engine)
  | 'NODE_TIMEOUT'
  | 'NODE_TYPE_MISMATCH'
  | 'NODE_EGRESS_BLOCKED'
  // Generic
  | 'INTERNAL_ERROR';

export class LoopError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details: unknown;

  constructor(code: ErrorCode, message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = 'LoopError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ValidationError extends LoopError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_TOPOLOGY', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends LoopError {
  constructor(resource: string, id: string) {
    super(
      `NOT_FOUND_${resource.toUpperCase()}` as ErrorCode,
      `${resource} '${id}' not found`,
      404,
    );
    this.name = 'NotFoundError';
  }
}

export class AuthenticationError extends LoopError {
  constructor(code: ErrorCode = 'AUTH_INVALID_TOKEN', message = 'Authentication failed') {
    super(code, message, 401);
    this.name = 'AuthenticationError';
  }
}

export class ForbiddenError extends LoopError {
  constructor(message = 'Insufficient permissions') {
    super('FORBIDDEN_INSUFFICIENT_ROLE', message, 403);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends LoopError {
  constructor(message: string) {
    super('CONFLICT_DUPLICATE', message, 409);
    this.name = 'ConflictError';
  }
}

export class UpstreamError extends LoopError {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 502);
    this.name = 'UpstreamError';
  }
}
