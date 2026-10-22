import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getAuthenticatedUser } from "@/lib/auth";
import { getGoogleServerEnv } from "@/lib/env";
import { oauthCookieOptions, verifyOAuthCallbackState } from "@/lib/google/oauth-state";
import { createGoogleOAuthClient, googleClientId } from "@/lib/google/server";
import { canReuseExistingRefreshToken, validateGoogleGrantedScopes } from "@/lib/google/errors";
import { commitGoogleConnection, findOwnedGoogleAccount, getOwnedGoogleAccount, GoogleAccountConflictError, loadOwnedRefreshToken } from "@/lib/google/token-store";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

function settingsRedirect(request: Request, result: string) {
  return NextResponse.redirect(new URL(`/settings?gmail=${encodeURIComponent(result)}`, request.url));
}

function clearCookies(response: NextResponse) {
  const options = { ...oauthCookieOptions(process.env.NODE_ENV === "production"), maxAge: 0 };
  response.cookies.set("google_oauth_state", "", options);
  response.cookies.set("google_oauth_verifier", "", options);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request) {
  const jar = await cookies();
  const stateCookie = jar.get("google_oauth_state")?.value;
  const verifierCookie = jar.get("google_oauth_verifier")?.value;
  const params = new URL(request.url).searchParams;
  let result = "oauth_failed";
  try {
    if (params.has("error")) {
      result = "oauth_denied";
      return clearCookies(settingsRedirect(request, result));
    }
    const client = await createUserSupabaseClient();
    const user = await getAuthenticatedUser(client);
    if (!user) {
      result = "sign_in_required";
      return clearCookies(settingsRedirect(request, result));
    }
    const env = getGoogleServerEnv();
    const verified = verifyOAuthCallbackState(params.get("state"), stateCookie, user.id, Buffer.from(env.TOKEN_ENCRYPTION_KEY, "hex"));
    const verifierA = Buffer.from(verifierCookie ?? "", "utf8");
    const verifierB = Buffer.from(verified.valid ? verified.codeVerifierCookie : "", "utf8");
    if (!verified.valid || !verifierCookie || verifierA.length !== verifierB.length || !timingSafeEqual(verifierA, verifierB)) {
      result = "oauth_state_invalid";
      return clearCookies(settingsRedirect(request, result));
    }
    const admin = createAdminSupabaseClient();
    const { data: consumed, error: consumeError } = await admin.rpc("consume_google_oauth_state", {
      p_owner_id: user.id,
      p_state_hash: createHash("sha256").update(params.get("state")!).digest("hex"),
    });
    if (consumeError || !consumed) {
      result = "oauth_state_invalid";
      return clearCookies(settingsRedirect(request, result));
    }
    const code = params.get("code");
    if (!code || code.length > 4096) return clearCookies(settingsRedirect(request, result));

    const oauth = createGoogleOAuthClient();
    const { tokens } = await oauth.getToken({ code, codeVerifier: verified.codeVerifierCookie });
    if (!tokens.id_token || !tokens.access_token || !validateGoogleGrantedScopes(tokens.scope)) {
      result = "gmail_scope_missing";
      return clearCookies(settingsRedirect(request, result));
    }
    const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: googleClientId() });
    const claims = ticket.getPayload();
    if (!claims?.sub || !claims.email || claims.email_verified !== true) return clearCookies(settingsRedirect(request, result));

    const matchingAccount = await findOwnedGoogleAccount(client, user.id, claims.sub);
    const activeAccount = await getOwnedGoogleAccount(client, user.id);
    if (activeAccount && activeAccount.provider_subject !== claims.sub) {
      result = "disconnect_before_switch";
      return clearCookies(settingsRedirect(request, result));
    }
    const hasExistingRefreshToken = matchingAccount?.status === "connected"
      && canReuseExistingRefreshToken({
        hasRefreshToken: Boolean(await loadOwnedRefreshToken(client, user.id, matchingAccount.id)),
        matchingAccount: true,
        connected: true,
      });
    if (!tokens.refresh_token && !hasExistingRefreshToken) {
      result = "refresh_token_missing";
      return clearCookies(settingsRedirect(request, result));
    }
    await commitGoogleConnection({
      ownerId: user.id,
      providerSubject: claims.sub,
      email: claims.email,
      refreshToken: tokens.refresh_token ?? undefined,
      existingAccount: matchingAccount,
    });
    result = "connected";
  } catch (error) {
    result = error instanceof GoogleAccountConflictError ? "google_account_in_use" : "oauth_failed";
  }
  return clearCookies(settingsRedirect(request, result));
}
