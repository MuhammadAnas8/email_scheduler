export type SafeGoogleError = "reauthorization_required" | "refresh_unavailable" | "provider_forbidden" | "rate_limited" | "provider_unavailable" | "send_failed" | "outcome_uncertain";

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const ALLOWED_SCOPES = new Set(["openid", "email", "profile", GMAIL_SEND_SCOPE]);

export function validateGoogleGrantedScopes(scope: string | undefined): boolean {
  if (!scope) return false;
  const granted = scope.split(/\s+/).filter(Boolean);
  return granted.includes(GMAIL_SEND_SCOPE) && !granted.some((item) =>
    (item.startsWith("https://www.googleapis.com/auth/gmail") || item === "https://mail.google.com/") && !ALLOWED_SCOPES.has(item),
  );
}

export function canReuseExistingRefreshToken(input: { hasRefreshToken: boolean; matchingAccount: boolean; connected: boolean }): boolean {
  return input.hasRefreshToken && input.matchingAccount && input.connected;
}

function providerStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { response?: { status?: unknown }; code?: unknown; status?: unknown };
  const value = candidate.response?.status ?? candidate.status;
  return typeof value === "number" ? value : undefined;
}

export function isInvalidGrant(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { response?: { data?: { error?: unknown } }; code?: unknown; message?: unknown };
  return candidate.response?.data?.error === "invalid_grant" || candidate.code === "invalid_grant" || candidate.message === "invalid_grant";
}

export function classifyGoogleError(error: unknown, stage: "refresh" | "send"): SafeGoogleError {
  if (isInvalidGrant(error)) return "reauthorization_required";
  const status = providerStatus(error);
  if (status === 403) return "provider_forbidden";
  if (status === 429) return "rate_limited";
  if (status !== undefined && status >= 500) return stage === "send" ? "provider_unavailable" : "refresh_unavailable";
  if (status !== undefined) return "send_failed";
  return stage === "send" ? "outcome_uncertain" : "refresh_unavailable";
}

export function safeGoogleMessage(code: SafeGoogleError): string {
  switch (code) {
    case "reauthorization_required": return "Gmail needs to be reconnected. Disconnect and connect your account again.";
    case "refresh_unavailable": return "Google could not refresh the connection temporarily. No test email was sent; wait and try again.";
    case "provider_forbidden": return "Google did not allow this test send. Check Gmail access and account settings.";
    case "rate_limited": return "Google is temporarily limiting sends. Wait before trying a new test.";
    case "provider_unavailable": return "Google did not confirm the send. Check Gmail Sent before starting another test.";
    case "outcome_uncertain": return "Google may have accepted this email. Check Gmail Sent before starting another test.";
    case "send_failed": return "Google rejected this test email. Review the message and try a new confirmed test.";
  }
}

export function sanitizeOAuthError(): string { return "Google authorization did not complete. Please try connecting again."; }
