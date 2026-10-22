import { NextResponse } from "next/server";
import { getAuthenticatedUser, readBodyBytes } from "@/lib/auth";
import { gmailTestRequestSchema } from "@/lib/schemas";
import { MAX_CV_BYTES, validatePdfAttachment } from "@/lib/attachments";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import { getOwnedGoogleAccount, loadOwnedRefreshToken, setOwnedAccountStatus } from "@/lib/google/token-store";
import { GmailRefreshError, sendSingleGmailMessage } from "@/lib/google/gmail";
import { classifyGoogleError, isInvalidGrant, safeGoogleMessage, type SafeGoogleError } from "@/lib/google/errors";
import { executeClaimedTestSend, hasSelectedAttachment } from "@/lib/google/test-send-core";

const MAX_REQUEST_BYTES = MAX_CV_BYTES + 128 * 1024;

function respond(status: string, requestId: string, code?: string | null, providerMessageId?: string | null, httpStatus = 200) {
  const safeCode = code as SafeGoogleError | undefined;
  const message = status === "sent" ? "The test email was accepted by Gmail." : safeCode ? safeGoogleMessage(safeCode) : undefined;
  return NextResponse.json({ status, requestId, ...(message ? { message } : {}), ...(safeCode ? { code: safeCode } : {}), ...(providerMessageId ? { providerMessageId } : {}) }, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const client = await createUserSupabaseClient();
  const user = await getAuthenticatedUser(client);
  if (!user) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) return NextResponse.json({ error: "Submit the test email form again." }, { status: 400 });
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_REQUEST_BYTES) return NextResponse.json({ error: "The attachment must be 10 MiB or smaller." }, { status: 413 });

  let form: FormData;
  try {
    const body = await readBodyBytes(request, MAX_REQUEST_BYTES);
    form = await new Response(Buffer.from(body), { headers: { "content-type": contentType } }).formData();
  } catch {
    return NextResponse.json({ error: "The test email request is invalid or too large." }, { status: 400 });
  }
  if (["requestId", "recipient", "subject", "text", "attestation", "confirmed"].some((key) => form.getAll(key).length !== 1)
    || form.getAll("attachment").length > 1) {
    return NextResponse.json({ error: "The test email request has duplicate or missing fields." }, { status: 400 });
  }
  const formFile = form.get("attachment");
  if (formFile !== null && !(formFile instanceof File)) return NextResponse.json({ error: "The attachment is invalid." }, { status: 400 });
  const file = formFile instanceof File && hasSelectedAttachment(formFile) ? formFile : null;
  const parsed = gmailTestRequestSchema.safeParse({
    requestId: form.get("requestId"),
    recipient: form.get("recipient"),
    subject: form.get("subject"),
    text: form.get("text"),
    attestation: form.get("attestation") === "on",
    confirmed: form.get("confirmed") === "true",
  });
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid recipient, subject, message, and confirmation." }, { status: 400 });
  const attachment = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : undefined;
  if (attachment) {
    const pdf = validatePdfAttachment(attachment);
    if (!pdf.ok) return NextResponse.json({ error: pdf.error }, { status: 400 });
  }

  const { data: allowed, error: rateError } = await client.rpc("consume_app_rate_limit", { p_action: "gmail_test" });
  if (rateError) return NextResponse.json({ error: "Could not validate the request." }, { status: 500 });
  if (!allowed) return NextResponse.json({ error: "Too many manual test sends. Try again in a minute." }, { status: 429 });
  let account;
  try { account = await getOwnedGoogleAccount(client, user.id); }
  catch { return NextResponse.json({ error: "Could not load Gmail connection." }, { status: 500 }); }
  if (!account) return NextResponse.json({ error: "Connect a Gmail account before sending a test." }, { status: 409 });

  const admin = createAdminSupabaseClient();
  const result = await executeClaimedTestSend(parsed.data.requestId, {
    claim: async (requestId) => {
      const { data, error } = await admin.rpc("claim_gmail_test_send", { p_owner_id: user.id, p_request_id: requestId });
      if (error || !data?.[0]) throw new Error("Could not claim manual test send.");
      const row = data[0];
      return { claimed: row.claimed, status: row.status, providerMessageId: row.provider_message_id, errorCode: row.error_code };
    },
    send: async () => {
      let refreshToken: string | null;
      try { refreshToken = await loadOwnedRefreshToken(client, user.id, account.id); }
      catch { return { status: "failed", errorCode: "reauthorization_required" }; }
      if (!refreshToken) return { status: "failed", errorCode: "reauthorization_required" };
      try {
        const providerMessageId = await sendSingleGmailMessage({
          ownerId: user.id, accountId: account.id, refreshToken, from: account.email,
          recipient: parsed.data.recipient, subject: parsed.data.subject, text: parsed.data.text, attachment,
        });
        return { status: "sent", providerMessageId };
      } catch (error) {
        const refreshStage = error instanceof GmailRefreshError;
        const providerError = refreshStage ? error.causeValue : error;
        const code = classifyGoogleError(providerError, refreshStage ? "refresh" : "send");
        if (isInvalidGrant(providerError)) await setOwnedAccountStatus(user.id, account.id, "revoked");
        if (!refreshStage && (code === "provider_unavailable" || code === "outcome_uncertain")) return { status: "uncertain", errorCode: code };
        return { status: "failed", errorCode: code };
      }
    },
    finish: async (requestId, outcome) => {
      const { error } = await admin.rpc("finish_gmail_test_send", {
        p_owner_id: user.id,
        p_request_id: requestId,
        p_status: outcome.status,
        p_provider_message_id: outcome.providerMessageId ?? null,
        p_error_code: outcome.errorCode ?? null,
      });
      if (error) throw new Error("Could not record manual test result.");
    },
  });
  if (!result.claimed) return respond(result.status, parsed.data.requestId, result.errorCode, result.providerMessageId, result.status === "sending" ? 202 : 200);
  if (result.status === "sent") return respond(result.status, parsed.data.requestId, undefined, result.providerMessageId);
  return respond(result.status, parsed.data.requestId, result.errorCode, null, result.status === "uncertain" ? 202 : 200);
}
