import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";

function localSupabaseEnv() {
  const fromProcess = {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  let fromCli = {};
  if (!fromProcess.url || !fromProcess.anonKey || !fromProcess.serviceRoleKey) {
    const output = execFileSync("supabase", ["status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const values = Object.fromEntries(
      output
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*(?:export\s+)?([A-Z_]+)=(.*)$/))
        .filter(Boolean)
        .map(([, key, raw]) => [key, raw.trim().replace(/^['"]|['"]$/g, "")]),
    );
    fromCli = {
      url: values.API_URL,
      anonKey: values.ANON_KEY ?? values.PUBLISHABLE_KEY,
      serviceRoleKey: values.SERVICE_ROLE_KEY ?? values.SECRET_KEY,
    };
  }

  const config = {
    url: fromProcess.url ?? fromCli.url,
    anonKey: fromProcess.anonKey ?? fromCli.anonKey,
    serviceRoleKey: fromProcess.serviceRoleKey ?? fromCli.serviceRoleKey,
  };
  assert.ok(config.url && config.anonKey && config.serviceRoleKey, "Local Supabase credentials are unavailable.");

  const endpoint = new URL(config.url);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname) && endpoint.port === "55421",
    "Storage policy tests are restricted to this repository's local Supabase endpoint (port 55421).",
  );
  return config;
}

test("CV storage access is scoped to the authenticated owner and owned batch", async () => {
  const { url, anonKey, serviceRoleKey } = localSupabaseEnv();
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const userAId = randomUUID();
  const userBId = randomUUID();
  const password = `Phase2-${randomUUID()}-Aa1!`;
  const userAEmail = `${userAId}@phase2.example.test`;
  const userBEmail = `${userBId}@phase2.example.test`;
  const batchId = randomUUID();
  const objectPath = `${userAId}/${batchId}/cv.pdf`;
  let userA;
  let userB;

  try {
    const { data: createdA, error: createAError } = await admin.auth.admin.createUser({
      id: userAId, email: userAEmail, password, email_confirm: true,
    });
    assert.ifError(createAError);
    assert.ok(createdA.user);
    const { data: createdB, error: createBError } = await admin.auth.admin.createUser({
      id: userBId, email: userBEmail, password, email_confirm: true,
    });
    assert.ifError(createBError);
    assert.ok(createdB.user);

    userA = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    userB = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const [{ error: signInAError }, { error: signInBError }] = await Promise.all([
      userA.auth.signInWithPassword({ email: userAEmail, password }),
      userB.auth.signInWithPassword({ email: userBEmail, password }),
    ]);
    assert.ifError(signInAError);
    assert.ifError(signInBError);

    const { error: batchError } = await admin.from("email_batches").insert({
      id: batchId, owner_id: userAId, name: "Storage policy fixture", status: "draft",
    });
    assert.ifError(batchError);

    const pdf = Buffer.from("%PDF-1.4\nphase2 storage policy fixture\n%%EOF\n");
    const { error: uploadError } = await userA.storage.from("cv-attachments").upload(objectPath, pdf, {
      contentType: "application/pdf", upsert: false,
    });
    assert.ifError(uploadError);

    const ownerDownload = await userA.storage.from("cv-attachments").download(objectPath);
    assert.ifError(ownerDownload.error);
    assert.ok(ownerDownload.data);

    const foreignDownload = await userB.storage.from("cv-attachments").download(objectPath);
    assert.ok(foreignDownload.error, "another user cannot download the object");
    const foreignList = await userB.storage.from("cv-attachments").list(`${userAId}/${batchId}`);
    assert.equal(foreignList.data?.length ?? 0, 0, "another user cannot list the object");

    const foreignUpload = await userB.storage.from("cv-attachments").upload(objectPath, pdf, {
      contentType: "application/pdf", upsert: false,
    });
    assert.ok(foreignUpload.error, "another user cannot upload into the owner's path");

    const wrongBatchUpload = await userA.storage.from("cv-attachments").upload(
      `${userAId}/${randomUUID()}/cv.pdf`, pdf, { contentType: "application/pdf", upsert: false },
    );
    assert.ok(wrongBatchUpload.error, "owner cannot upload against a nonexistent batch");

    const foreignDelete = await userB.storage.from("cv-attachments").remove([objectPath]);
    assert.ok(foreignDelete.error || foreignDelete.data?.length === 0, "another user cannot delete the object");
    const stillPresent = await userA.storage.from("cv-attachments").download(objectPath);
    assert.ifError(stillPresent.error);

    const { error: ownerDeleteError } = await userA.storage.from("cv-attachments").remove([objectPath]);
    assert.ifError(ownerDeleteError);
  } finally {
    if (userA) await userA.auth.signOut();
    if (userB) await userB.auth.signOut();
    await admin.storage.from("cv-attachments").remove([objectPath]);
    await admin.auth.admin.deleteUser(userAId);
    await admin.auth.admin.deleteUser(userBId);
  }
});
