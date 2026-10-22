import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { decryptRefreshToken, encryptRefreshToken } from "../lib/google/token-crypto-core.ts";
import { createOAuthStartState, oauthCookieOptions, verifyOAuthCallbackState } from "../lib/google/oauth-state.ts";
import { buildGmailRawMessage } from "../lib/google/mime.ts";
import { executeClaimedTestSend, hasSelectedAttachment } from "../lib/google/test-send-core.ts";
import { gmailTestRequestSchema } from "../lib/schemas.ts";
import { canReuseExistingRefreshToken, classifyGoogleError, safeGoogleMessage, validateGoogleGrantedScopes } from "../lib/google/errors.ts";
import { validatePdfAttachment } from "../lib/attachments.ts";

const key = new Uint8Array(32).fill(7);

test("refresh tokens round-trip with owner/account-bound authenticated encryption", () => {
  const encrypted = encryptRefreshToken("refresh-token-secret", "owner-a", "account-a", key);
  assert.equal(decryptRefreshToken(encrypted, "owner-a", "account-a", key), "refresh-token-secret");
  assert.notDeepEqual(encrypted.nonce, encryptRefreshToken("refresh-token-secret", "owner-a", "account-a", key).nonce);
  assert.throws(() => decryptRefreshToken(encrypted, "owner-b", "account-a", key));
  assert.throws(() => decryptRefreshToken(encrypted, "owner-a", "account-b", key));
  assert.throws(() => decryptRefreshToken(encrypted, "owner-a", "account-a", new Uint8Array(32).fill(8)));
  assert.throws(() => encryptRefreshToken("x", "owner-a", "account-a", new Uint8Array(31)));
  assert.throws(() => decryptRefreshToken({ ...encrypted, keyVersion: 2 }, "owner-a", "account-a", key));
  const tampered = { ...encrypted, ciphertext: new Uint8Array(encrypted.ciphertext).map((byte, i) => i === 0 ? byte ^ 1 : byte) };
  assert.throws(() => decryptRefreshToken(tampered, "owner-a", "account-a", key));
  const badTag = { ...encrypted, tag: new Uint8Array(encrypted.tag).map((byte, i) => i === 0 ? byte ^ 1 : byte) };
  assert.throws(() => decryptRefreshToken(badTag, "owner-a", "account-a", key));
});

test("OAuth state binds PKCE to the current owner and expires", () => {
  const now = 1_800_000_000_000;
  const started = createOAuthStartState("owner-a", key, now);
  assert.equal(started.codeChallenge, createHash("sha256").update(started.codeVerifier).digest("base64url"));
  assert.deepEqual(verifyOAuthCallbackState(started.state, started.signedStateCookie, "owner-a", key, now + 1), { valid: true, codeVerifierCookie: started.codeVerifier });
  assert.deepEqual(verifyOAuthCallbackState("wrong", started.signedStateCookie, "owner-a", key, now + 1), { valid: false });
  assert.deepEqual(verifyOAuthCallbackState(started.state, started.signedStateCookie, "owner-b", key, now + 1), { valid: false });
  assert.deepEqual(verifyOAuthCallbackState(started.state, started.signedStateCookie, "owner-a", key, now + 600_001), { valid: false });
  assert.deepEqual(verifyOAuthCallbackState(started.state, "", "owner-a", key, now + 1), { valid: false });
  assert.deepEqual(oauthCookieOptions(false), { httpOnly: true, secure: false, sameSite: "lax", path: "/api/auth/google/callback", maxAge: 600 });
  assert.equal(oauthCookieOptions(true).secure, true);
});

test("OAuth grants stay minimal and refresh tokens are reused only for the same active account", () => {
  assert.equal(validateGoogleGrantedScopes("openid email https://www.googleapis.com/auth/gmail.send"), true);
  assert.equal(validateGoogleGrantedScopes("openid email"), false);
  assert.equal(validateGoogleGrantedScopes("openid https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send"), false);
  assert.equal(validateGoogleGrantedScopes("https://mail.google.com/ https://www.googleapis.com/auth/gmail.send"), false);
  assert.equal(validateGoogleGrantedScopes(undefined), false);
  assert.equal(canReuseExistingRefreshToken({ hasRefreshToken: true, matchingAccount: true, connected: true }), true);
  assert.equal(canReuseExistingRefreshToken({ hasRefreshToken: true, matchingAccount: false, connected: true }), false);
  assert.equal(canReuseExistingRefreshToken({ hasRefreshToken: true, matchingAccount: true, connected: false }), false);
  assert.equal(canReuseExistingRefreshToken({ hasRefreshToken: false, matchingAccount: true, connected: true }), false);
});

test("MIME output is base64url, Unicode safe, and uses a fixed attachment filename", async () => {
  const raw = await buildGmailRawMessage({
    from: "owner@example.com", to: "professor@example.net", subject: "研究のご相談 — résumé", text: "こんにちは, Professor.\nThank you.",
    attachment: new Uint8Array(Buffer.from("%PDF-1.4\nbody\n%%EOF")),
  });
  assert.match(raw, /^[A-Za-z0-9_-]+$/);
  const mime = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(mime, /multipart\/mixed/i);
  assert.match(mime, /\r\n/);
  assert.match(mime, /filename=?"?cv\.pdf"?/i);
  assert.match(mime, /^From: owner@example\.com/im);
  assert.doesNotMatch(mime, /^From: professor@example\.net/im);
  await assert.rejects(() => buildGmailRawMessage({ from: "owner@example.com", to: "owner@example.com", subject: "hello\r\nBcc: victim@example.com", text: "body" }));
});

test("duplicate concurrent manual-send requests share one claim and send once", async () => {
  const records = new Map<string, { status: string }>();
  let sends = 0;
  const dependencies = {
    claim: async (id: string) => {
      if (records.has(id)) return { claimed: false, status: records.get(id)!.status };
      records.set(id, { status: "sending" });
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { claimed: true, status: "sending" };
    },
    send: async () => { sends += 1; return { status: "sent" as const, providerMessageId: "provider-id" }; },
    finish: async (_id: string, outcome: { status: string }) => { records.set(_id, { status: outcome.status }); },
  };
  const results = await Promise.all([
    executeClaimedTestSend("same-request", dependencies),
    executeClaimedTestSend("same-request", dependencies),
  ]);
  assert.equal(sends, 1);
  assert.equal(results.filter((result) => result.claimed).length, 1);
  assert.equal(results.filter((result) => !result.claimed).length, 1);
});

test("manual-send schema requires a user attestation and explicit confirmation", () => {
  const valid = { requestId: "53ed418a-fb78-46f1-9663-3102d9f4556c", recipient: "owner@example.com", subject: "Test", text: "Hello", attestation: true, confirmed: true };
  assert.equal(gmailTestRequestSchema.safeParse(valid).success, true);
  assert.equal(gmailTestRequestSchema.safeParse({ ...valid, attestation: false }).success, false);
  assert.equal(gmailTestRequestSchema.safeParse({ ...valid, confirmed: false }).success, false);
  assert.equal(gmailTestRequestSchema.safeParse({ ...valid, owner_id: "attacker" }).success, false);
});

test("if result persistence fails after a claimed send, outcome is uncertain", async () => {
  const result = await executeClaimedTestSend("request", {
    claim: async () => ({ claimed: true, status: "sending" }),
    send: async () => ({ status: "sent", providerMessageId: "gmail-id" }),
    finish: async () => { throw new Error("database unavailable"); },
  });
  assert.equal(result.status, "uncertain");
});

test("provider failures are categorized without exposing provider text", () => {
  assert.equal(classifyGoogleError({ response: { status: 403, data: "private provider detail" } }, "send"), "provider_forbidden");
  assert.equal(classifyGoogleError({ response: { status: 429 } }, "send"), "rate_limited");
  assert.equal(classifyGoogleError({ response: { status: 503 } }, "send"), "provider_unavailable");
  assert.equal(classifyGoogleError({ code: "ETIMEDOUT" }, "send"), "outcome_uncertain");
  assert.equal(classifyGoogleError({ response: { data: { error: "invalid_grant" } } }, "refresh"), "reauthorization_required");
  assert.equal(classifyGoogleError({ response: { status: 503 } }, "refresh"), "refresh_unavailable");
  assert.equal(classifyGoogleError({ code: "ETIMEDOUT" }, "refresh"), "refresh_unavailable");
  assert.doesNotMatch(safeGoogleMessage("provider_forbidden"), /private provider detail/);
});

test("test-send attachment validation checks file bytes rather than name or browser type", () => {
  assert.deepEqual(validatePdfAttachment(new Uint8Array(Buffer.from("%PDF-1.4\ncontent\n%%EOF"))), { ok: true });
  assert.equal(validatePdfAttachment(new Uint8Array(Buffer.from("not a pdf"))).ok, false);
});

test("an empty file input is treated as no optional attachment", () => {
  assert.equal(hasSelectedAttachment({ name: "", size: 0 }), false);
  assert.equal(hasSelectedAttachment({ name: "cv.pdf", size: 0 }), true);
  assert.equal(hasSelectedAttachment(null), false);
});
