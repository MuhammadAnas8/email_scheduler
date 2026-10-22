import "server-only";

import type { Database } from "@/lib/database.types";
import { createUserSupabaseClient } from "@/lib/supabase/server";

export type EmailBatchRow = Database["public"]["Tables"]["email_batches"]["Row"];
export type ScheduledEmailRow = Database["public"]["Tables"]["scheduled_emails"]["Row"];

export type SchedulerOverview = {
  batches: EmailBatchRow[];
  messages: ScheduledEmailRow[];
};

export async function getSchedulerOverview(): Promise<SchedulerOverview> {
  const supabase = await createUserSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw new Error("You must be signed in to view scheduler data.");
  }

  const [batchesResult, messagesResult] = await Promise.all([
    supabase.from("email_batches").select("*").order("created_at", { ascending: false }),
    supabase.from("scheduled_emails").select("*").order("created_at", { ascending: false }),
  ]);

  if (batchesResult.error || messagesResult.error) {
    throw new Error("Scheduler data could not be loaded.");
  }

  return {
    batches: batchesResult.data,
    messages: messagesResult.data,
  };
}
