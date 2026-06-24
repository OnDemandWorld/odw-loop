import { z } from 'zod';

export const ActionItemSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  assignee: z.string().optional(),
  due_date: z.string().datetime().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  source_transcript_id: z.string().uuid().optional(),
  created_at: z.string().datetime(),
});
export type ActionItem = z.infer<typeof ActionItemSchema>;
