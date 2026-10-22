import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthenticatedUser } from "@/lib/auth";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import { getGoogleServerEnv } from "@/lib/env";
import { createOAuthStartState, oauthCookieOptions } from "@/lib/google/oauth-state";
import { createGoogleOAuthClient, GOOGLE_OAUTH_SCOPES } from "@/lib/google/server";
import { createHash } from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const client = await createUserSupabaseClient();
  const user = await getAuthenticatedUser(client);
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const env = getGoogleServerEnv();
  const state = createOAuthStartState(user.id, Buffer.from(env.TOKEN_ENCRYPTION_KEY, "hex"));
  const admin = createAdminSupabaseClient();
  const { error: stateError } = await admin.rpc("register_google_oauth_state", {
    p_owner_id: user.id,
    p_state_hash: createHash("sha256").update(state.state).digest("hex"),
    p_expires_at: new Date(state.expiresAt).toISOString(),
  });
  if (stateError) return NextResponse.json({ error: "Could not start Google authorization." }, { status: 500 });
  const oauth = createGoogleOAuthClient();
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...GOOGLE_OAUTH_SCOPES],
    state: state.state,
    code_challenge: state.codeChallenge,
    // google-auth-library types this string enum nominally; the OAuth wire value is the standard literal.
    code_challenge_method: "S256" as never,
  });
  const response = NextResponse.redirect(url);
  const jar = await cookies();
  const options = oauthCookieOptions(process.env.NODE_ENV === "production");
  jar.set("google_oauth_state", state.signedStateCookie, options);
  jar.set("google_oauth_verifier", state.codeVerifier, options);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
