import { NextResponse } from "next/server";
import { getAuthenticatedUser, readJsonBody } from "@/lib/auth";
import { batchActionSchema, resourceIdSchema } from "@/lib/schemas";
import { invalidRequestResponse, oversizedRequestResponse, queueRpcErrorResponse } from "@/lib/queue-api";
import { createUserSupabaseClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ batchId: string }> };

const actionRpcs = {
  pause: "pause_email_batch",
  resume: "resume_email_batch",
  cancel: "cancel_email_batch",
} as const;

export async function POST(request: Request, context: RouteContext) {
  const { batchId } = await context.params;
  if (!resourceIdSchema.safeParse(batchId).success) return invalidRequestResponse();

  const supabase = await createUserSupabaseClient();
  if (!await getAuthenticatedUser(supabase)) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await readJsonBody(request, 1024);
  } catch (error) {
    return error instanceof RangeError ? oversizedRequestResponse() : invalidRequestResponse();
  }
  const input = batchActionSchema.safeParse(body);
  if (!input.success) return invalidRequestResponse();

  const { data, error } = await supabase.rpc(actionRpcs[input.data.action], { p_batch_id: batchId });
  if (error) return queueRpcErrorResponse(error);
  if (!data) return NextResponse.json({ error: "The queue action could not be saved." }, { status: 500 });
  return NextResponse.json({ id: batchId, status: data });
}
