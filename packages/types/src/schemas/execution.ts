import { z } from 'zod';

export const ExecutionTriggerTypeSchema = z.enum(['manual', 'cron', 'webhook', 'event']);
export type ExecutionTriggerType = z.infer<typeof ExecutionTriggerTypeSchema>;

export const ExecutionStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'paused',
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const NodeExecutionStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
]);
export type NodeExecutionStatus = z.infer<typeof NodeExecutionStatusSchema>;

export const WorkflowExecutionSchema = z.object({
  id: z.string().uuid(),
  workflow_id: z.string().uuid(),
  workflow_version: z.number().int().positive(),
  trigger_type: ExecutionTriggerTypeSchema,
  trigger_payload: z.record(z.unknown()).default({}),
  status: ExecutionStatusSchema.default('pending'),
  started_at: z.string().datetime().nullable().default(null),
  completed_at: z.string().datetime().nullable().default(null),
  duration_ms: z.number().int().nullable().default(null),
  error: z.string().nullable().default(null),
  initiated_by: z.string().uuid().nullable().default(null),
});
export type WorkflowExecution = z.infer<typeof WorkflowExecutionSchema>;

export const NodeExecutionSchema = z.object({
  id: z.string().uuid(),
  execution_id: z.string().uuid(),
  node_id: z.string().max(100),
  node_type: z.string().max(50),
  status: NodeExecutionStatusSchema,
  input: z.record(z.unknown()).default({}),
  output: z.record(z.unknown()).default({}),
  error: z.string().nullable().default(null),
  started_at: z.string().datetime().nullable().default(null),
  completed_at: z.string().datetime().nullable().default(null),
  retry_count: z.number().int().default(0),
  metadata: z.record(z.unknown()).default({}),
  // V1.1 M1 (F2 idempotency): `${execution_id}:${node_id}`. Optional/nullable so
  // V1.0 rows and callers that never opt in remain valid.
  idempotency_key: z.string().nullable().optional(),
});
export type NodeExecution = z.infer<typeof NodeExecutionSchema>;

// ─── Execution events (V1.1 M1 — append-only event log) ──────────────────────

export const ExecutionEventTypeSchema = z.enum([
  'execution_started',
  'node_started',
  'node_succeeded',
  'node_failed',
  'node_skipped',
  'execution_succeeded',
  'execution_failed',
  'execution_recovered',
]);
export type ExecutionEventType = z.infer<typeof ExecutionEventTypeSchema>;

export const ExecutionEventSchema = z.object({
  id: z.string(),
  execution_id: z.string(),
  event_type: ExecutionEventTypeSchema,
  node_id: z.string().nullable().optional(),
  payload: z.record(z.unknown()).default({}),
  created_at: z.number().int(),
});
export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;
