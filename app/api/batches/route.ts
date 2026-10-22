import { NextResponse } from "next/server";
import { getAuthenticatedUser, readJsonBody } from "@/lib/auth";
import { createDraftSchema } from "@/lib/schemas";
import { createUserSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createUserSupabaseClient();
  if (!await getAuthenticatedUser(supabase)) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try { body = await readJsonBody(request, 10 * 1024 * 1024); }
  catch (error) {
    return NextResponse.json({ error: error instanceof RangeError ? "Draft request is too large." : "Request must be valid JSON." }, { status: error instanceof RangeError ? 413 : 400 });
  }
  const input = createDraftSchema.safeParse(body);
  if (!input.success) return NextResponse.json({ error: "A draft needs a name and 1–200 valid email records." }, { status: 400 });

  const { data, error } = await supabase.rpc("create_draft_email_batch", {
    p_name: input.data.name,
    p_messages: input.data.messages,
  });
  if (error?.message.includes("rate limit") || error?.code === "P0001") return NextResponse.json({ error: "Too many draft requests. Try again in a minute." }, { status: 429 });
  if (error || !data) return NextResponse.json({ error: "Draft could not be saved." }, { status: 400 });
  return NextResponse.json({ id: data }, { status: 201 });
}
