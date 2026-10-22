export const batchStatuses = [
  "draft",
  "scheduled",
  "running",
  "paused",
  "completed",
  "cancelled",
  "failed",
] as const;

export type BatchStatus = (typeof batchStatuses)[number];

export const messageStatuses = [
  "pending",
  "sending",
  "sent",
  "retrying",
  "failed",
  "skipped",
  "uncertain",
] as const;

export type MessageStatus = (typeof messageStatuses)[number];

export interface EmailRecord {
  recipient: string;
  subject: string;
  body: string;
}
