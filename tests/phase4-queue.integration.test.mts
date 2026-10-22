import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types.ts";

type TestClient = SupabaseClient<Database>;

const url = process.env.PHASE4_TEST_SUPABASE_URL;
const anonKey = process.env.PHASE4_TEST_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.PHASE4_TEST_SUPABASE_SERVICE_ROLE_KEY;

function localConfigurationError() {
  if (!url || !anonKey || !serviceRoleKey) {
    return "Set PHASE4_TEST_SUPABASE_URL, PHASE4_TEST_SUPABASE_ANON_KEY, and PHASE4_TEST_SUPABASE_SERVICE_ROLE_KEY for a disposable local Supabase project.";
  }
  try {
    const parsed = new URL(url);
    if (!(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname))) {
      return "Phase 4 integration tests only run against a loopback local Supabase URL.";
    }
    if (parsed.protocol !== "http:") return "Phase 4 integration tests require local HTTP Supabase, not a hosted HTTPS project.";
  } catch {
    return "PHASE4_TEST_SUPABASE_URL must be a valid local URL.";
  }
  return null;
}

const skipReason = localConfigurationError();

test("queue RPCs preserve ordering, ownership, idempotency, and concurrent state", { skip: skipReason ?? false }, async () => {
  const endpoint = url as string;
  const admin = createClient<Database>(endpoint, serviceRoleKey as string, { auth: { persistSession: false } });
  const password = `Phase4-${randomUUID()}-Ab1!`;
  const userAEmail = `phase4-a-${randomUUID()}@example.test`;
  const userBEmail = `phase4-b-${randomUUID()}@example.test`;
  let userAId: string | undefined;
  let userBId: string | undefined;
  let userA: TestClient | undefined;
  let userB: TestClient | undefined;

  async function createFixtureUser(email: string) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(error);
    assert.ok(data.user);
    const client = createClient<Database>(endpoint, anonKey as string, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    assert.ifError(signInError);
    return { id: data.user.id, client };
  }

  async function createDraft(client: TestClient, name: string, count: number) {
    const messages = Array.from({ length: count }, (_, index) => ({
      recipient: `recipient-${index + 1}@example.test`,
      subject: `${name} ${index + 1}`,
      body: "A private integration fixture body.",
    }));
    const { data, error } = await client.rpc("create_draft_email_batch", {
      p_name: name,
      p_messages: messages,
    });
    assert.ifError(error);
    assert.equal(typeof data, "string");
    return { id: data as string, messageCount: count };
  }

  async function schedule(client: TestClient, batchId: string, startsAt: string | null, intervalSeconds: number) {
    const { data, error } = await client.rpc("schedule_email_batch", {
      p_batch_id: batchId,
      p_starts_at: startsAt,
      p_interval_seconds: intervalSeconds,
    });
    assert.ifError(error);
    assert.equal(data, batchId);
  }

  try {
    const fixtureA = await createFixtureUser(userAEmail);
    userAId = fixtureA.id;
    userA = fixtureA.client;
    const ownerA = userA;
    const fixtureB = await createFixtureUser(userBEmail);
    userBId = fixtureB.id;
    userB = fixtureB.client;
    const ownerB = userB;

    const immediate = await createDraft(ownerA, "Immediate", 3);
    await schedule(ownerA, immediate.id, null, 5);
    const { data: initialBatch, error: initialBatchError } = await ownerA.from("email_batches")
      .select("status, starts_at, interval_seconds").eq("id", immediate.id).single();
    assert.ifError(initialBatchError);
    assert.equal(initialBatch.status, "scheduled");
    assert.equal(initialBatch.interval_seconds, 5);
    assert.ok(initialBatch.starts_at);

    await schedule(ownerA, immediate.id, new Date(Date.now() + 60_000).toISOString(), 10);
    const { data: repeatedBatch, error: repeatedBatchError } = await ownerA.from("email_batches")
      .select("starts_at, interval_seconds").eq("id", immediate.id).single();
    assert.ifError(repeatedBatchError);
    assert.deepEqual(repeatedBatch, { starts_at: initialBatch.starts_at, interval_seconds: 5 });
    const { data: orderedMessages, error: orderedError } = await ownerA.from("scheduled_emails")
      .select("id, position, status, scheduled_at, next_attempt_at").eq("batch_id", immediate.id).order("position");
    assert.ifError(orderedError);
    assert.equal(orderedMessages.length, immediate.messageCount);
    assert.deepEqual(orderedMessages.map((message) => message.position), [1, 2, 3]);
    assert.deepEqual(orderedMessages.map((message) => message.status), ["pending", "pending", "pending"]);
    assert.equal(Date.parse(orderedMessages[1]!.scheduled_at!) - Date.parse(orderedMessages[0]!.scheduled_at!), 5000);
    assert.equal(orderedMessages[2]!.next_attempt_at, orderedMessages[2]!.scheduled_at);

    const future = await createDraft(ownerA, "Future", 2);
    const futureStart = new Date(Date.now() + 120_000).toISOString();
    await schedule(ownerA, future.id, futureStart, 10);
    const freshUserClient = createClient<Database>(endpoint, anonKey as string, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: freshSignInError } = await freshUserClient.auth.signInWithPassword({ email: userAEmail, password });
    assert.ifError(freshSignInError);
    const { data: persistedFuture, error: persistedFutureError } = await freshUserClient.from("scheduled_emails")
      .select("position, scheduled_at").eq("batch_id", future.id).order("position");
    assert.ifError(persistedFutureError);
    assert.equal(Date.parse(persistedFuture[0]!.scheduled_at!), Date.parse(futureStart));
    assert.equal(Date.parse(persistedFuture[1]!.scheduled_at!) - Date.parse(persistedFuture[0]!.scheduled_at!), 10_000);
    await freshUserClient.auth.signOut();

    assert.equal((await ownerA.rpc("pause_email_batch", { p_batch_id: immediate.id })).data, "paused");
    assert.equal((await ownerA.rpc("pause_email_batch", { p_batch_id: immediate.id })).data, "paused");
    assert.equal((await ownerA.rpc("resume_email_batch", { p_batch_id: immediate.id })).data, "scheduled");
    assert.equal((await ownerA.rpc("resume_email_batch", { p_batch_id: immediate.id })).data, "scheduled");
    assert.equal((await ownerA.rpc("skip_scheduled_email", { p_batch_id: immediate.id, p_message_id: orderedMessages[0]!.id })).data, "skipped");
    assert.equal((await ownerA.rpc("skip_scheduled_email", { p_batch_id: immediate.id, p_message_id: orderedMessages[0]!.id })).data, "skipped");

    const otherOwnerBatch = await createDraft(ownerB, "Other owner", 1);
    await schedule(ownerB, otherOwnerBatch.id, null, 5);
    const otherOwnerMessage = (await ownerB.from("scheduled_emails").select("id").eq("batch_id", otherOwnerBatch.id).single()).data;
    assert.ok(otherOwnerMessage);
    assert.deepEqual((await ownerA.from("email_batches").select("id").eq("id", otherOwnerBatch.id)).data, []);
    assert.equal((await ownerA.rpc("schedule_email_batch", { p_batch_id: otherOwnerBatch.id, p_starts_at: null, p_interval_seconds: 5 })).error?.code, "P0002");
    assert.equal((await ownerA.rpc("pause_email_batch", { p_batch_id: otherOwnerBatch.id })).error?.code, "P0002");
    assert.equal((await ownerA.rpc("resume_email_batch", { p_batch_id: otherOwnerBatch.id })).error?.code, "P0002");
    assert.equal((await ownerA.rpc("cancel_email_batch", { p_batch_id: otherOwnerBatch.id })).error?.code, "P0002");
    assert.equal((await ownerA.rpc("skip_scheduled_email", { p_batch_id: otherOwnerBatch.id, p_message_id: otherOwnerMessage.id })).error?.code, "P0002");
    assert.equal((await ownerA.rpc("get_email_batch_counts")).data?.some((row) => row.batch_id === otherOwnerBatch.id), false);

    const pauseCancel = await createDraft(ownerA, "Pause cancel race", 2);
    await schedule(ownerA, pauseCancel.id, null, 5);
    const pauseCancelResults = await Promise.all([
      ownerA.rpc("pause_email_batch", { p_batch_id: pauseCancel.id }),
      ownerA.rpc("cancel_email_batch", { p_batch_id: pauseCancel.id }),
    ]);
    assert.equal(pauseCancelResults[1]?.data, "cancelled");
    const { data: cancelledBatch, error: cancelledBatchError } = await ownerA.from("email_batches")
      .select("status").eq("id", pauseCancel.id).single();
    assert.ifError(cancelledBatchError);
    assert.equal(cancelledBatch.status, "cancelled");

    const skipCancel = await createDraft(ownerA, "Skip cancel race", 2);
    await schedule(ownerA, skipCancel.id, null, 5);
    const skipCancelMessages = (await ownerA.from("scheduled_emails").select("id").eq("batch_id", skipCancel.id).order("position")).data;
    assert.equal(skipCancelMessages?.length, 2);
    const skipCancelResults = await Promise.all([
      ownerA.rpc("skip_scheduled_email", { p_batch_id: skipCancel.id, p_message_id: skipCancelMessages![0]!.id }),
      ownerA.rpc("cancel_email_batch", { p_batch_id: skipCancel.id }),
    ]);
    const skipResult = skipCancelResults[0]!;
    assert.ok(skipResult.data === "skipped" || skipResult.error?.code === "55000");
    const { data: finalRaceMessages, error: finalRaceError } = await ownerA.from("scheduled_emails")
      .select("status").eq("batch_id", skipCancel.id);
    assert.ifError(finalRaceError);
    assert.equal(finalRaceMessages.filter((message) => message.status === "pending").length, 0);
    assert.equal(finalRaceMessages.filter((message) => message.status === "cancelled").length, skipResult.data === "skipped" ? 1 : 2);

    const { data: counts, error: countsError } = await ownerA.rpc("get_email_batch_counts").eq("batch_id", skipCancel.id).single();
    assert.ifError(countsError);
    assert.equal(counts.total_count, finalRaceMessages.length);
    assert.equal(counts.cancelled_count, finalRaceMessages.filter((message) => message.status === "cancelled").length);
    assert.equal(counts.skipped_count, finalRaceMessages.filter((message) => message.status === "skipped").length);
  } finally {
    await userA?.auth.signOut();
    await userB?.auth.signOut();
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
  }
});
