import "server-only";

import type { Database } from "@/lib/database.types";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import type { EmailBatchCounts } from "@/lib/types";

export type EmailBatchRow = Database["public"]["Tables"]["email_batches"]["Row"];
export type ScheduledEmailRow = Database["public"]["Tables"]["scheduled_emails"]["Row"];

export type SchedulerOverview = {
  batches: EmailBatchRow[];
  messages: ScheduledEmailRow[];
  counts: EmailBatchCounts[];
};

export type SchedulerBatchDetails = {
  batch: EmailBatchRow;
  messages: ScheduledEmailRow[];
  counts: EmailBatchCounts;
};

async function requireUserClient() {
  const supabase = await createUserSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("You must be signed in to view scheduler data.");
  return supabase;
}

async function loadAllBatches() {
  const supabase = await requireUserClient();
  const rows: EmailBatchRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("email_batches").select("*")
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + 999);
    if (error) throw new Error("Scheduler data could not be loaded.");
    rows.push(...data);
    if (data.length < 1000) return { supabase, rows };
  }
}

async function loadAllMessages(supabase: Awaited<ReturnType<typeof requireUserClient>>) {
  const rows: ScheduledEmailRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("scheduled_emails").select("*")
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + 999);
    if (error) throw new Error("Scheduler data could not be loaded.");
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function loadAllCounts(supabase: Awaited<ReturnType<typeof requireUserClient>>) {
  const rows: EmailBatchCounts[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.rpc("get_email_batch_counts")
      .range(offset, offset + 999);
    if (error) throw new Error("Scheduler data could not be loaded.");
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export async function getSchedulerOverview(): Promise<SchedulerOverview> {
  const { supabase, rows: batches } = await loadAllBatches();
  const [messages, counts] = await Promise.all([
    loadAllMessages(supabase),
    loadAllCounts(supabase),
  ]);
  return { batches, messages, counts };
}

export async function getSchedulerCounts(): Promise<EmailBatchCounts[]> {
  const supabase = await requireUserClient();
  return loadAllCounts(supabase);
}

export async function getSchedulerBatchDetails(batchId: string): Promise<SchedulerBatchDetails | null> {
  const supabase = await requireUserClient();
  const { data: batch, error: batchError } = await supabase.from("email_batches")
    .select("*").eq("id", batchId).maybeSingle();
  if (batchError) throw new Error("Batch details could not be loaded.");
  if (!batch) return null;

  const [messagesResult, countsResult] = await Promise.all([
    supabase.from("scheduled_emails").select("*").eq("batch_id", batchId).order("position"),
    supabase.rpc("get_email_batch_counts").eq("batch_id", batchId).maybeSingle(),
  ]);
  if (messagesResult.error || countsResult.error) throw new Error("Batch details could not be loaded.");
  return {
    batch,
    messages: messagesResult.data,
    counts: countsResult.data ?? {
      batch_id: batchId,
      total_count: 0,
      pending_count: 0,
      skipped_count: 0,
      cancelled_count: 0,
      sent_count: 0,
      failed_count: 0,
      uncertain_count: 0,
    },
  };
}
