import { z } from 'zod';

export const ConnectorTypeSchema = z.enum([
  'vault',
  'desk',
  'recap',
  'generic',
]);
export type ConnectorType = z.infer<typeof ConnectorTypeSchema>;

export const ConnectorStatusSchema = z.enum(['connected', 'disconnected', 'error']);
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;

export const ConnectorSchema = z.object({
  id: z.string().uuid(),
  connector_type: ConnectorTypeSchema,
  name: z.string().max(100),
  config: z.record(z.unknown()),
  status: ConnectorStatusSchema.default('disconnected'),
  last_health_check: z.string().datetime().nullable().default(null),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Connector = z.infer<typeof ConnectorSchema>;

/** What a connector advertises it can do. */
export const ConnectorCapabilitiesSchema = z.object({
  node_types: z.array(z.string()),
  input_types: z.array(z.string()).default([]),
  output_types: z.array(z.string()).default([]),
});
export type ConnectorCapabilities = z.infer<typeof ConnectorCapabilitiesSchema>;
