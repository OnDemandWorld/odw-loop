import { z } from 'zod';

export const TranscriptEntrySchema = z.object({
  speaker: z.string(),
  text: z.string(),
  start_time: z.number(),
  end_time: z.number(),
});
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

/** Recap meeting transcript. */
export const TranscriptSchema = z.object({
  id: z.string().uuid(),
  meeting_id: z.string(),
  title: z.string().optional(),
  entries: z.array(TranscriptEntrySchema),
  duration_seconds: z.number(),
  created_at: z.string().datetime(),
});
export type Transcript = z.infer<typeof TranscriptSchema>;
