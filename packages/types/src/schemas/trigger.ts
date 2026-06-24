import { z } from 'zod';

export const TriggerTypeSchema = z.enum(['cron', 'webhook', 'event', 'manual']);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export const CronTriggerConfigSchema = z.object({
  expression: z.string(),
  timezone: z.string().default('UTC'),
});

export const WebhookTriggerConfigSchema = z.object({
  path: z.string(),
  secret: z.string(),
  method: z.enum(['POST', 'PUT']).default('POST'),
});

export const EventTriggerConfigSchema = z.object({
  source: z.enum(['vault', 'desk', 'recap']),
  event_type: z.string(),
  filter: z.record(z.unknown()).default({}),
});

export const TriggerConfigSchema = z.union([
  CronTriggerConfigSchema,
  WebhookTriggerConfigSchema,
  EventTriggerConfigSchema,
  z.record(z.unknown()), // manual — empty config
]);
export type TriggerConfig = z.infer<typeof TriggerConfigSchema>;

export const WorkflowTriggerSchema = z.object({
  id: z.string().uuid(),
  workflow_id: z.string().uuid(),
  trigger_type: TriggerTypeSchema,
  config: TriggerConfigSchema,
  enabled: z.boolean().default(true),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type WorkflowTrigger = z.infer<typeof WorkflowTriggerSchema>;
