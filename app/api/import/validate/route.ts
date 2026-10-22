import { NextResponse } from "next/server";
import { getAuthenticatedUser, readJsonBody } from "@/lib/auth";
import { parseImport } from "@/lib/imports";
import { importRequestSchema } from "@/lib/schemas";
import { createUserSupabaseClient } from "@/lib/supabase/server";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  const supabase = await createUserSupabaseClient();
  if (!await getAuthenticatedUser(supabase)) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { data: allowed, error: limitError } = await supabase.rpc("consume_app_rate_limit", { p_action: "import" });
  if (limitError || !allowed) return NextResponse.json({ error: "Too many imports. Try again in a minute." }, { status: 429 });

  let body: unknown;
  try { body = await readJsonBody(request, MAX_IMPORT_BYTES); }
  catch (error) {
    const tooLarge = error instanceof RangeError;
    return NextResponse.json({ error: tooLarge ? "Import request must be 2 MiB or smaller." : "Import request must be valid JSON." }, { status: tooLarge ? 413 : 400 });
  }
  const requestData = importRequestSchema.safeParse(body);
  if (!requestData.success) return NextResponse.json({ error: "Provide a CSV or JSON import under 2 MiB." }, { status: 400 });

  const result = parseImport(requestData.data.format, requestData.data.content);
  if (!result.ok) return NextResponse.json(result, { status: 422 });
  return NextResponse.json(result);
}
