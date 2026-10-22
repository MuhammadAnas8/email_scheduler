import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createGoogleOAuthClient } from "@/lib/google/server";
import { disconnectOwnedAccount, getOwnedGoogleAccount, listOwnedGoogleAccounts, loadOwnedRefreshToken } from "@/lib/google/token-store";
import { createUserSupabaseClient } from "@/lib/supabase/server";

export async function GET() {
  const client = await createUserSupabaseClient();
  const user = await getAuthenticatedUser(client);
  if (!user) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  try {
    const active = await getOwnedGoogleAccount(client, user.id);
    if (active) return NextResponse.json({ status: "connected", email: active.email });
    const accounts = await listOwnedGoogleAccounts(client, user.id);
    const previous = accounts[0];
    return NextResponse.json({ status: previous?.status === "revoked" || previous?.status === "error" ? "reconnect_required" : "disconnected", email: previous?.email ?? null });
  } catch {
    return NextResponse.json({ error: "Could not load Gmail connection." }, { status: 500 });
  }
}

export async function POST() {
  const client = await createUserSupabaseClient();
  const user = await getAuthenticatedUser(client);
  if (!user) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  try {
    const active = await getOwnedGoogleAccount(client, user.id);
    const account = active ?? (await listOwnedGoogleAccounts(client, user.id))[0];
    if (!account) return NextResponse.json({ error: "No Gmail connection was found." }, { status: 404 });
    let remoteRevoked = false;
    if (active) {
      try {
        const refreshToken = await loadOwnedRefreshToken(client, user.id, account.id);
        if (refreshToken) {
          await createGoogleOAuthClient().revokeToken(refreshToken);
          remoteRevoked = true;
        }
      } catch {
        remoteRevoked = false;
      }
    }
    await disconnectOwnedAccount(user.id, account.id);
    return NextResponse.json({ status: "disconnected", remoteRevoked });
  } catch {
    return NextResponse.json({ error: "Could not disconnect Gmail." }, { status: 500 });
  }
}
