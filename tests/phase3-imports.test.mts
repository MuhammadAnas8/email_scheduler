import assert from "node:assert/strict";
import { test } from "node:test";
import { parseImport } from "../lib/imports.ts";
import { validatePdfAttachment } from "../lib/attachments.ts";
import { getAuthenticatedUser, readBodyBytes, readJsonBody } from "../lib/auth.ts";
import { getSupabaseAdminServerEnv, getSupabasePublicServerEnv } from "../lib/env.ts";

test("accepts current Supabase public and server-only key names", () => {
  assert.deepEqual(getSupabasePublicServerEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  }), {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_test",
  });
  assert.deepEqual(getSupabaseAdminServerEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_SECRET_KEY: "sb_secret_test",
  }), {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_test",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
  });
});

test("reports malformed CSV and JSON imports", () => {
  assert.equal(parseImport("csv", 'recipient,subject,body\n"broken').ok, false);
  assert.equal(parseImport("json", "[{bad json]").ok, false);
});

test("returns row-level errors for invalid addresses and missing fields", () => {
  const result = parseImport("json", JSON.stringify([
    { recipient: "not-an-address", subject: "Hello", body: "A full message" },
    { recipient: "person@example.com", subject: "", body: "A full message" },
    { recipient: "person@example.com", subject: "Hello", body: "  " },
  ]));

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.rows.map((row) => row.errors.map((error) => error.field)), [
      ["recipient"], ["subject"], ["body"],
    ]);
    assert.equal(result.rows[1]?.errors[0]?.message, "Subject is required");
    assert.equal(result.rows[2]?.errors[0]?.message, "Message body is required");
  }
});

test("parses CSV with headers and preserves the full plain-text body", () => {
  const result = parseImport("csv", 'recipient,subject,body\nperson@example.com,Hello,"first line\nsecond line"\n');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.rows[0]?.value.body, "first line\nsecond line");
});

test("rejects imports larger than 200 records", () => {
  const records = Array.from({ length: 201 }, (_, index) => ({
    recipient: `person${index}@example.com`, subject: "Hello", body: "A full message",
  }));
  const result = parseImport("json", JSON.stringify(records));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /200/);
});

test("validates PDF bytes and enforces the 10 MiB limit", () => {
  const pdf = new Uint8Array(Buffer.from("%PDF-1.7\ncontent\n%%EOF\n"));
  assert.equal(validatePdfAttachment(pdf).ok, true);
  assert.equal(validatePdfAttachment(new Uint8Array(Buffer.from("not a pdf"))).ok, false);
  assert.equal(validatePdfAttachment(new Uint8Array(Buffer.from("%PDF-1.7 fake file"))).ok, false);
  assert.equal(validatePdfAttachment(new Uint8Array(10 * 1024 * 1024 + 1)).ok, false);
});

test("does not mistake an arbitrary filename or browser MIME type for a PDF", () => {
  const result = validatePdfAttachment(new Uint8Array(Buffer.from("MZ executable")));
  assert.equal(result.ok, false);
});

test("rejects access when Supabase has no verified authenticated user", async () => {
  const user = await getAuthenticatedUser({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } });
  assert.equal(user, null);
  const failedLookup = await getAuthenticatedUser({ auth: { getUser: async () => ({ data: { user: { id: "ignored" } }, error: new Error("invalid session") }) } });
  assert.equal(failedLookup, null);
});

test("bounds JSON request parsing before decoding oversized payloads", async () => {
  await assert.rejects(readJsonBody(new Request("http://localhost", { method: "POST", body: "12345" }), 4), RangeError);
  await assert.rejects(readBodyBytes(new Request("http://localhost", { method: "POST", body: "12345" }), 4), RangeError);
});
