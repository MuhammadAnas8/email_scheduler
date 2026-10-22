import { z } from "zod";
import { batchStatuses, messageStatuses } from "./types.ts";

export const batchStatusSchema = z.enum(batchStatuses);
export const messageStatusSchema = z.enum(messageStatuses);

export const emailRecordSchema = z.object({
  recipient: z.string().trim().max(320).pipe(z.email("Enter a valid email address")),
  subject: z.string().trim().min(1, "Subject is required").max(998, "Subject must be 998 characters or fewer"),
  body: z.string().max(10_000, "Message body must be 10,000 characters or fewer")
    .refine((body) => body.trim().length > 0, "Message body is required"),
});

export const importRequestSchema = z.object({
  format: z.enum(["csv", "json"]),
  content: z.string().max(2_000_000, "Import file must be 2 MiB or smaller"),
});

export const createDraftSchema = z.object({
  name: z.string().trim().min(1, "Batch name is required").max(120),
  messages: z.array(emailRecordSchema).min(1).max(200),
});

export const emailBatchSchema = z.object({
  name: z.string().trim().min(1, "Batch name is required").max(120),
  intervalSeconds: z.number().int().min(5).max(10),
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  messages: z.array(emailRecordSchema).min(1).max(200),
});

export type EmailRecordInput = z.infer<typeof emailRecordSchema>;
export type EmailBatchInput = z.infer<typeof emailBatchSchema>;
