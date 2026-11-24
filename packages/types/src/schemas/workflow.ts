import { z } from 'zod';

/** Position on canvas (React Flow coordinate space). */
export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type Position = z.infer<typeof PositionSchema>;

/** Retry configuration per node. Bounds keep a hostile/typo'd definition from
 *  producing a practically infinite retry loop (e.g. max_attempts: 1e9 with a
 *  1e9 ms base delay passed validation and wedged the node). */
export const RetryConfigSchema = z.object({
  max_attempts: z.number().int().min(0).max(20).default(3),
  backoff: z.enum(['exponential', 'linear', 'fixed']).default('exponential'),
  initial_delay_ms: z.number().int().min(0).max(60_000).default(1000),
});
export type RetryConfig = z.infer<typeof RetryConfigSchema>;

/** A node in the workflow definition graph. */
export const WorkflowNodeSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.string().min(1).max(50),
  position: PositionSchema,
  config: z.record(z.unknown()).default({}),
  retry: RetryConfigSchema.optional(),
  // Audit #67: cap at the setTimeout maximum (2^31-1 ms) — larger delays
  // overflow and fire after ~1ms, instantly failing the node.
  timeout_ms: z.number().int().positive().max(2_147_483_647).optional(),
  input_schema: z.record(z.string()).optional(),
  output_schema: z.record(z.string()).optional(),
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

/** An edge connecting two nodes. */
export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  source_port: z.string().default('output'),
  target: z.string().min(1),
  target_port: z.string().default('input'),
  type_compatibility: z.boolean().default(true),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

/** Variable definition. */
export const VariableDefinitionSchema = z.object({
  type: z.string(),
  default: z.unknown().optional(),
});
export type VariableDefinition = z.infer<typeof VariableDefinitionSchema>;

/**
 * Workflow-level execution settings (V1.1 M1 — F3 timeout hardening).
 * Optional so V1.0 definitions without a `settings` block stay valid; when
 * `workflow_timeout_ms` is absent the engine falls back to the env default.
 */
export const WorkflowSettingsSchema = z.object({
  // Audit #68: cap at the setTimeout maximum (2^31-1 ms) — larger delays
  // overflow and abort the workflow after ~1ms.
  workflow_timeout_ms: z.number().int().positive().max(2_147_483_647).optional(),
});
export type WorkflowSettings = z.infer<typeof WorkflowSettingsSchema>;

/** Complete workflow definition JSON (§4.11). */
export const WorkflowDefinitionSchema = z.object({
  version: z.string().default('1.0'),
  nodes: z.array(WorkflowNodeSchema).default([]),
  edges: z.array(WorkflowEdgeSchema).default([]),
  variables: z.record(VariableDefinitionSchema).default({}),
  settings: WorkflowSettingsSchema.optional(),
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).default([]),
    })
    .default({}),
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

/** Workflow status enum. */
export const WorkflowStatusSchema = z.enum(['draft', 'active', 'archived']);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

/** Database representation of a workflow. */
export const WorkflowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(255),
  description: z.string().default(''),
  definition: WorkflowDefinitionSchema,
  version: z.number().int().positive(),
  status: WorkflowStatusSchema.default('draft'),
  tags: z.array(z.string()).default([]),
  created_by: z.string().uuid(),
  updated_by: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

/** API request body for creating a workflow. */
export const CreateWorkflowRequestSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(10_000).optional(),
  definition: WorkflowDefinitionSchema,
  tags: z.array(z.string()).max(20).optional(),
});
export type CreateWorkflowRequest = z.infer<typeof CreateWorkflowRequestSchema>;

/** API request body for updating a workflow. */
export const UpdateWorkflowRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(10_000).optional(),
  definition: WorkflowDefinitionSchema.optional(),
  tags: z.array(z.string()).max(20).optional(),
  status: WorkflowStatusSchema.optional(),
});
export type UpdateWorkflowRequest = z.infer<typeof UpdateWorkflowRequestSchema>;

/** Workflow definition version snapshot. */
export const WorkflowDefinitionVersionSchema = z.object({
  id: z.string().uuid(),
  workflow_id: z.string().uuid(),
  version: z.number().int().positive(),
  definition: WorkflowDefinitionSchema,
  commit_hash: z.string().length(40),
  created_by: z.string().uuid(),
  created_at: z.string().datetime(),
  change_summary: z.string().default(''),
});
export type WorkflowDefinitionVersion = z.infer<typeof WorkflowDefinitionVersionSchema>;
