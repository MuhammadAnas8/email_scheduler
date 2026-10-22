import { createHmac, hkdfSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";

const LIFETIME_MS = 10 * 60 * 1000;
function signingKey(encryptionKey: Uint8Array) {
  if (encryptionKey.byteLength !== 32) throw new Error("OAuth state key is unavailable.");
  return Buffer.from(hkdfSync("sha256", encryptionKey, Buffer.alloc(0), "email-scheduler/google-oauth-state/v1", 32));
}

function equal(a: string, b: string) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createOAuthStartState(ownerId: string, encryptionKey: Uint8Array, now = Date.now()) {
  if (!ownerId) throw new Error("OAuth state owner is missing.");
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ state, ownerId, issuedAt: now, codeVerifier })).toString("base64url");
  const signature = createHmac("sha256", signingKey(encryptionKey)).update(payload).digest("base64url");
  return {
    state,
    codeVerifier,
    codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
    signedStateCookie: `${payload}.${signature}`,
    expiresAt: now + LIFETIME_MS,
  };
}

export function verifyOAuthCallbackState(
  queryState: string | null,
  signedStateCookie: string | undefined,
  currentOwnerId: string,
  encryptionKey: Uint8Array,
  now = Date.now(),
): { valid: true; codeVerifierCookie: string } | { valid: false } {
  try {
    if (!queryState || queryState.length > 128 || !signedStateCookie || signedStateCookie.length > 2048 || !currentOwnerId) return { valid: false };
    const [payload, signature, extra] = signedStateCookie.split(".");
    if (!payload || !signature || extra !== undefined) return { valid: false };
    const expected = createHmac("sha256", signingKey(encryptionKey)).update(payload).digest("base64url");
    if (!equal(signature, expected)) return { valid: false };
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      state?: unknown; ownerId?: unknown; issuedAt?: unknown; codeVerifier?: unknown;
    };
    if (typeof parsed.state !== "string" || typeof parsed.ownerId !== "string" || typeof parsed.issuedAt !== "number" || typeof parsed.codeVerifier !== "string") return { valid: false };
    if (!equal(queryState, parsed.state) || !equal(currentOwnerId, parsed.ownerId)) return { valid: false };
    if (parsed.issuedAt > now || now - parsed.issuedAt > LIFETIME_MS || !/^[A-Za-z0-9_-]{43}$/.test(parsed.codeVerifier)) return { valid: false };
    return { valid: true, codeVerifierCookie: parsed.codeVerifier };
  } catch {
    return { valid: false };
  }
}

export function oauthCookieOptions(production: boolean) {
  return { httpOnly: true, secure: production, sameSite: "lax" as const, path: "/api/auth/google/callback", maxAge: 600 };
}
