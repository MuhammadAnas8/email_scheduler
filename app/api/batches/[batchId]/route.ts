import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { resourceIdSchema } from "@/lib/schemas";
import { createUserSupabaseClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ batchId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { batchId } = await context.params;
  if (!resourceIdSchema.safeParse(batchId).success) {
    return NextResponse.json({ error: "The request is invalid." }, { status: 400 });
  }

  const supabase = await createUserSupabaseClient();
  if (!await getAuthenticatedUser(supabase)) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { data: batch, error: batchError } = await supabase.from("email_batches")
    .select("*").eq("id", batchId).maybeSingle();
  if (batchError) return NextResponse.json({ error: "Batch could not be loaded." }, { status: 500 });
  if (!batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });

  const [messagesResult, countsResult] = await Promise.all([
    supabase.from("scheduled_emails").select("*").eq("batch_id", batchId).order("position"),
    supabase.rpc("get_email_batch_counts").eq("batch_id", batchId).maybeSingle(),
  ]);
  if (messagesResult.error || countsResult.error) {
    return NextResponse.json({ error: "Batch details could not be loaded." }, { status: 500 });
  }
  return NextResponse.json({ batch, messages: messagesResult.data, counts: countsResult.data });
}
