import { NextResponse } from "next/server";
import { getAuthenticatedUser, readJsonBody } from "@/lib/auth";
import { resourceIdSchema, scheduleBatchRequestSchema } from "@/lib/schemas";
import { invalidRequestResponse, oversizedRequestResponse, queueRpcErrorResponse } from "@/lib/queue-api";
import { createUserSupabaseClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ batchId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { batchId } = await context.params;
  if (!resourceIdSchema.safeParse(batchId).success) return invalidRequestResponse();

  const supabase = await createUserSupabaseClient();
  if (!await getAuthenticatedUser(supabase)) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await readJsonBody(request, 2 * 1024);
  } catch (error) {
    return error instanceof RangeError ? oversizedRequestResponse() : invalidRequestResponse();
  }
  const input = scheduleBatchRequestSchema.safeParse(body);
  if (!input.success) return invalidRequestResponse();

  const { data, error } = await supabase.rpc("schedule_email_batch", {
    p_batch_id: batchId,
    p_starts_at: input.data.startsAt,
    p_interval_seconds: input.data.intervalSeconds,
  });
  if (error) return queueRpcErrorResponse(error);
  if (!data) return NextResponse.json({ error: "The queue action could not be saved." }, { status: 500 });
  const { data: batch, error: batchError } = await supabase.from("email_batches")
    .select("status").eq("id", data).maybeSingle();
  if (batchError || !batch) return NextResponse.json({ error: "The queue status could not be loaded." }, { status: 500 });
  return NextResponse.json({ id: data, status: batch.status });
}
