import "server-only";

import { OAuth2Client } from "google-auth-library";
import { getGoogleServerEnv } from "@/lib/env";

export const GOOGLE_OAUTH_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.send"] as const;

export function createGoogleOAuthClient() {
  const env = getGoogleServerEnv();
  return new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
    transporterOptions: { timeout: 15_000 },
  });
}

export function googleClientId() {
  return getGoogleServerEnv().GOOGLE_CLIENT_ID;
}
