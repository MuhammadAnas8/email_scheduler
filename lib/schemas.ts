import { z } from "zod";

export const emailRecordSchema = z.object({
  recipient: z.email(),
  subject: z.string().trim().min(1, "Subject is required"),
  body: z.string().trim().min(1, "Message body is required"),
});

export const emailBatchSchema = z.object({
  name: z.string().trim().min(1, "Batch name is required").max(120),
  intervalSeconds: z.number().int().min(5).max(10),
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  messages: z.array(emailRecordSchema).min(1).max(200),
});

export type EmailRecordInput = z.infer<typeof emailRecordSchema>;
export type EmailBatchInput = z.infer<typeof emailBatchSchema>;
