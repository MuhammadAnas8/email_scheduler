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
  "cancelled",
] as const;

export type MessageStatus = (typeof messageStatuses)[number];

// Persisted records will be scoped to a stable Supabase Auth user ID.
export interface EmailRecord {
  recipient: string;
  subject: string;
  body: string;
}

export const batchActions = ["pause", "resume", "cancel"] as const;
export type BatchAction = (typeof batchActions)[number];

export interface ScheduleBatchRequest {
  startsAt: string | null;
  intervalSeconds: number;
}

export interface EmailBatchCounts {
  batch_id: string;
  total_count: number;
  pending_count: number;
  skipped_count: number;
  cancelled_count: number;
  sent_count: number;
  failed_count: number;
  uncertain_count: number;
}

export interface BatchActionResult {
  id: string;
  status: "scheduled" | "paused" | "cancelled";
}
