import { z } from 'zod';

/** Vault document (knowledge-base entity). */
export const DocumentSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  content_type: z.string().default('text/plain'),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Document = z.infer<typeof DocumentSchema>;
