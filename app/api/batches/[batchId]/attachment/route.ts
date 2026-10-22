import { NextResponse } from "next/server";
import { getAuthenticatedUser, readBodyBytes } from "@/lib/auth";
import { MAX_CV_BYTES, validatePdfAttachment } from "@/lib/attachments";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createUserSupabaseClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ batchId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const supabase = await createUserSupabaseClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { data: allowed, error: limitError } = await supabase.rpc("consume_app_rate_limit", { p_action: "attachment" });
  if (limitError || !allowed) return NextResponse.json({ error: "Too many upload attempts. Try again in a minute." }, { status: 429 });

  const { batchId } = await context.params;
  const { data: batch, error: batchError } = await supabase.from("email_batches")
    .select("id, status").eq("id", batchId).maybeSingle();
  if (batchError || !batch) return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  if (batch.status !== "draft") return NextResponse.json({ error: "Attachments can only be added to drafts." }, { status: 409 });

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_CV_BYTES + 64 * 1024) return NextResponse.json({ error: "The PDF must be 10 MiB or smaller." }, { status: 413 });
  let form: FormData;
  try {
    const requestBytes = await readBodyBytes(request, MAX_CV_BYTES + 64 * 1024);
    const requestBuffer = new ArrayBuffer(requestBytes.byteLength);
    new Uint8Array(requestBuffer).set(requestBytes);
    form = await new Response(requestBuffer, { headers: request.headers }).formData();
  } catch (error) {
    const tooLarge = error instanceof RangeError;
    return NextResponse.json({ error: tooLarge ? "The PDF must be 10 MiB or smaller." : "Upload a PDF file." }, { status: tooLarge ? 413 : 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Upload a PDF file." }, { status: 400 });
  if (file.size > MAX_CV_BYTES) return NextResponse.json({ error: "The PDF must be 10 MiB or smaller." }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validatePdfAttachment(bytes);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  const path = `${user.id}/${batchId}/cv.pdf`;
  // Storage write policies intentionally deny authenticated direct uploads. This
  // privileged client is used only after the session, batch ownership, and bytes
  // have been verified above.
  const admin = createAdminSupabaseClient();
  const { error: uploadError } = await admin.storage.from("cv-attachments").upload(path, bytes, {
    contentType: "application/pdf", upsert: true, cacheControl: "3600",
  });
  if (uploadError) return NextResponse.json({ error: "PDF could not be stored for this draft." }, { status: 400 });

  const { error: updateError } = await supabase.from("email_batches").update({ attachment_path: path })
    .eq("id", batchId).eq("status", "draft");
  if (updateError) return NextResponse.json({ error: "PDF was uploaded, but draft metadata could not be updated. Retry the upload." }, { status: 500 });
  return NextResponse.json({ uploaded: true });
}
