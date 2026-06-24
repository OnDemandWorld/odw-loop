import { z } from 'zod';

export const CalendarEventSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().optional(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  attendees: z.array(z.string()).default([]),
  location: z.string().optional(),
  created_at: z.string().datetime(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
