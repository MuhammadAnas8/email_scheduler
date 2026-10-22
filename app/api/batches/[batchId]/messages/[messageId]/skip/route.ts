import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { resourceIdSchema } from "@/lib/schemas";
import { invalidRequestResponse, queueRpcErrorResponse } from "@/lib/queue-api";
import { createUserSupabaseClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ batchId: string; messageId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { batchId, messageId } = await context.params;
  if (!resourceIdSchema.safeParse(batchId).success || !resourceIdSchema.safeParse(messageId).success) {
    return invalidRequestResponse();
  }

  const supabase = await createUserSupabaseClient();
  if (!await getAuthenticatedUser(supabase)) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { data, error } = await supabase.rpc("skip_scheduled_email", {
    p_batch_id: batchId,
    p_message_id: messageId,
  });
  if (error) return queueRpcErrorResponse(error);
  if (!data) return NextResponse.json({ error: "The queue action could not be saved." }, { status: 500 });
  return NextResponse.json({ id: messageId, status: data });
}
