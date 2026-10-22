import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { decryptRefreshToken, encryptRefreshToken } from "./token-crypto";
import type { EncryptedToken } from "./token-crypto-core";

type UserClient = SupabaseClient<Database>;
type Account = Database["public"]["Tables"]["connected_accounts"]["Row"];
export class GoogleAccountConflictError extends Error {}
const bytea = (value: Uint8Array) => `\\x${Buffer.from(value).toString("hex")}`;
function bytes(value: string): Uint8Array {
  const hex = value.startsWith("\\\\x") ? value.slice(2) : value.startsWith("\\x") ? value.slice(2) : value;
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw new Error("Stored token encoding is invalid.");
  return Buffer.from(hex, "hex");
}
function encryptedFromRow(row: { ciphertext: string; nonce: string; auth_tag: string; key_version: number }): EncryptedToken {
  return { ciphertext: bytes(row.ciphertext), nonce: bytes(row.nonce), tag: bytes(row.auth_tag), keyVersion: row.key_version };
}

export async function getOwnedGoogleAccount(client: UserClient, ownerId: string): Promise<Account | null> {
  const { data, error } = await client.from("connected_accounts").select("*").eq("owner_id", ownerId).eq("status", "connected").maybeSingle();
  if (error) throw new Error("Could not load Gmail connection.");
  return data;
}

export async function findOwnedGoogleAccount(client: UserClient, ownerId: string, providerSubject: string): Promise<Account | null> {
  const { data, error } = await client.from("connected_accounts").select("*").eq("owner_id", ownerId).eq("provider", "google").eq("provider_subject", providerSubject).maybeSingle();
  if (error) throw new Error("Could not load Gmail connection.");
  return data;
}

export async function listOwnedGoogleAccounts(client: UserClient, ownerId: string): Promise<Account[]> {
  const { data, error } = await client.from("connected_accounts").select("*").eq("owner_id", ownerId).eq("provider", "google").order("updated_at", { ascending: false }).limit(10);
  if (error) throw new Error("Could not load Gmail connection.");
  return data ?? [];
}

export async function commitGoogleConnection(input: {
  ownerId: string; accountId?: string; providerSubject: string; email: string; refreshToken?: string; existingAccount?: Account | null;
}) {
  const accountId = input.existingAccount?.id ?? input.accountId ?? randomUUID();
  const secret = input.refreshToken ? encryptRefreshToken(input.refreshToken, input.ownerId, accountId) : null;
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("upsert_google_connection", {
    p_owner_id: input.ownerId,
    p_account_id: accountId,
    p_provider_subject: input.providerSubject,
    p_email: input.email,
    p_ciphertext: secret ? bytea(secret.ciphertext) : null,
    p_nonce: secret ? bytea(secret.nonce) : null,
    p_auth_tag: secret ? bytea(secret.tag) : null,
    p_key_version: secret?.keyVersion ?? null,
  });
  if (error || !data) {
    if (error?.code === "23505") throw new GoogleAccountConflictError();
    throw new Error("Could not save Gmail connection. Reconnect or disconnect the current account first.");
  }
  return data;
}

export async function loadOwnedRefreshToken(client: UserClient, ownerId: string, accountId: string) {
  const { data: account, error: accountError } = await client.from("connected_accounts").select("id,status").eq("owner_id", ownerId).eq("id", accountId).eq("status", "connected").maybeSingle();
  if (accountError || !account) return null;
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("read_google_refresh_token", { p_owner_id: ownerId, p_account_id: account.id });
  const row = data?.[0];
  if (error || !row) return null;
  return decryptRefreshToken(encryptedFromRow(row), ownerId, accountId);
}

export async function persistRotatedRefreshToken(ownerId: string, accountId: string, refreshToken: string) {
  const secret = encryptRefreshToken(refreshToken, ownerId, accountId);
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("replace_google_refresh_token", {
    p_owner_id: ownerId,
    p_account_id: accountId,
    p_ciphertext: bytea(secret.ciphertext),
    p_nonce: bytea(secret.nonce),
    p_auth_tag: bytea(secret.tag),
    p_key_version: secret.keyVersion,
  });
  if (error || !data) throw new Error("Could not save refreshed Gmail credentials.");
}

export async function disconnectOwnedAccount(ownerId: string, accountId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("delete_google_refresh_token", { p_owner_id: ownerId, p_account_id: accountId });
  if (error) throw new Error("Could not disconnect Gmail locally.");
  return Boolean(data);
}

export async function setOwnedAccountStatus(ownerId: string, accountId: string, status: "revoked" | "error") {
  const admin = createAdminSupabaseClient();
  await admin.rpc("set_google_connection_status", { p_owner_id: ownerId, p_account_id: accountId, p_status: status });
}
