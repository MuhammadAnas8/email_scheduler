# Phase 5 Gmail OAuth and Manual Test Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each signed-in user connect one Gmail account, keep its refresh token encrypted on the server, and manually send one confirmed plain-text test email with an optional validated PDF.

**Architecture:** Use Google’s server-side OAuth authorization-code flow with unpredictable, one-time state, PKCE, offline access, and a narrow Gmail scope. Keep account identity/status in the existing owner-scoped `connected_accounts` table and encrypted token material plus manual-test idempotency records in a private PostgreSQL schema. Use server-only routes and services for OAuth, token decryption/refresh, MIME composition, Gmail API calls, and disconnect; the browser sees only safe connection metadata and sanitized outcomes.

**Tech Stack:** Next.js App Router route handlers, TypeScript, Supabase Auth and PostgreSQL/RLS, server-only Supabase clients, Node.js `crypto`, `googleapis`, Zod, Nodemailer MIME composition, Node's built-in test runner, and pgTAP.

**Spec:** Phase 5 requirements in `CODEX_TASK_PLAN.md`, the approved Phase 5 design in the preceding conversation, and Google’s [Gmail sending guide](https://developers.google.com/workspace/gmail/api/guides/sending), [Gmail `messages.send` reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send), and [OAuth web-server guide](https://developers.google.com/identity/protocols/oauth2/web-server).

## Global Constraints

- Use `https://www.googleapis.com/auth/gmail.send` as the only Gmail API scope; request `openid email` only to identify the Google account shown in Settings.
- Use `access_type=offline`, state validation, and PKCE; the OAuth redirect URI must match Google Cloud configuration exactly.
- Keep OAuth client secrets, authorization codes, access tokens, refresh tokens, encryption keys, and PKCE material in server-only code and HTTP-only cookies where applicable.
- Encrypt refresh tokens with AES-256-GCM using a 32-byte server-side key; bind ciphertext to the owner and connected-account IDs as authenticated additional data.
- Keep token rows and manual-send idempotency rows inaccessible to `anon` and `authenticated`; expose no token values from API responses, page props, or logs.
- Derive ownership only from a verified Supabase Auth user; never trust a browser-supplied `owner_id`.
- Make every Gmail action require a current authenticated user and an account row owned by that user.
- Send no scheduled batch messages; do not add queue/worker behavior, retry behavior, account rotation, quota bypass, spam evasion, or misleading From headers.
- A manual send succeeds only on a successful Gmail provider response. Treat an outcome lost after the request may have reached Gmail as uncertain and do not resend that request automatically.
- Preserve all Phase 3 import/PDF behavior and Phase 4 batch/message scheduling and controls.
- Use the repository's npm lockfile; do not add a new database or queue product.

## Review Focus

- A forged, expired, replayed, or session-swapped OAuth callback must not bind an account; test state mismatch, one-time use, expiry, and user binding.
- Token ciphertext copied to a different owner/account or modified in storage must fail authentication; test AES-GCM round-trip, AAD mismatch, tag tampering, and unsupported key version.
- A refresh token omitted on reauthorization must not erase a still-valid stored token or silently connect a different Google identity; test both cases, including an active-account switch attempt that requires explicit disconnect.
- A double click or request retry must not send a second manual test message; test concurrent duplicate idempotency keys and `uncertain` outcomes.
- Unicode headers/body, CRLF input, unsafe filename input, malformed PDF bytes, and oversized uploads must not produce injected headers or malformed/oversized MIME; test each at the MIME/request boundary.

---

## Design Decisions

### OAuth identity, state, and credentials

Add `GET /api/auth/google/start` and `GET /api/auth/google/callback`. Both verify the Supabase user server-side. Start creates a cryptographically random state and PKCE verifier/challenge. Store a signed owner-bound state payload (random state, Supabase user ID, issued-at time) and PKCE verifier in short-lived `HttpOnly`, `SameSite=Lax`, `Secure`-in-production cookies scoped to the callback. Sign the state payload with an HMAC key derived through HKDF from the token-encryption key using a distinct OAuth-state context label. Callback checks state and signature in constant time, enforces the 10-minute lifetime and same Supabase user, exchanges the code server-side with the verifier, verifies the returned ID token's audience/signature, and reads the Google `sub` and email from verified claims. Clear state/PKCE cookies on every callback path. Use `prompt=consent` with offline access for initial authorization and reauthorization; if Google omits a refresh token during reauthorization, preserve the existing encrypted token only when the Google `sub` matches the existing account. If a different Gmail account is currently active, require the user to disconnect it explicitly before connecting the new one. On an initial connection or account switch without a refresh token, fail closed with a reconnect instruction.

Request `openid email https://www.googleapis.com/auth/gmail.send`: OpenID/email are identity scopes and do not add Gmail mailbox access. Do not request Gmail read/modify/compose/full-mail scopes or use `include_granted_scopes` to broaden a connection implicitly. Validate that the granted scopes include `gmail.send` before storing the connection.

### Private token and manual-send records

Add a migration that keeps `connected_accounts` public metadata under its existing RLS read policy and creates `private.connected_account_tokens` with `(owner_id, connected_account_id)`, ciphertext, 12-byte nonce, 16-byte tag, key version, and timestamps. Use the existing composite owner/account foreign key pattern with `ON DELETE CASCADE`. Drop `connected_accounts_owner_unique` and replace it with a partial unique index on `owner_id WHERE status='connected'`; this preserves historical disconnected/revoked account rows while allowing only one active Gmail connection per user. Retain global uniqueness of `(provider, provider_subject)` so one Google identity cannot be linked to two app users. Enable RLS and revoke all table/schema access from `public`, `anon`, and `authenticated`. Keep the private schema out of PostgREST's exposed schema list. Add narrowly scoped public wrapper RPCs with pinned `search_path`, `SECURITY DEFINER`, and execute permission granted only to `service_role`; wrappers perform atomic upsert/read/delete/status changes and validate owner/account relationships. Server routes verify the user first, obtain the account ID through the user's RLS-scoped client, and only then call these wrappers using the server-only admin client.

Add `private.gmail_test_sends` to record only an owner, random request ID, state (`sending`, `sent`, `failed`, `uncertain`), safe provider message ID, sanitized error code, and timestamps. A unique `(owner_id, request_id)` plus an atomic claim/finalize RPC prevents duplicate browser submissions from making multiple Gmail calls. Reuse of a request ID in `sent`, `sending`, or `uncertain` state never sends again. If the process stops after Gmail may have accepted the email but before a success row is committed, a later request reports an uncertain outcome and tells the user to check Gmail Sent before starting a new, separately confirmed test. Extend the existing per-user rate-limit action set with `gmail_test` and allow a small fixed number of manual sends per minute. This table does not create scheduled queue rows or `email_attempts`.

### Token encryption and refresh

Create a server-only AES-256-GCM module. Parse `TOKEN_ENCRYPTION_KEY` as exactly 64 hex characters and reject invalid/absent keys without exposing values. Store ciphertext, nonce, tag, and `key_version=1`; use canonical AAD containing a version label, owner ID, and account ID. Never store plaintext refresh/access tokens in PostgreSQL. Keep access tokens only in the in-memory Google OAuth client for the current request. If a refreshed response provides a new refresh token, encrypt and atomically replace the stored ciphertext. A key version that is not supported fails closed and asks the operator to restore/configure the correct key; key rotation requires re-encryption and backup of old key material before switching versions.

Map `invalid_grant`/revocation to `connected_accounts.status='revoked'` and require reconnection. Map provider rate limit, temporary 5xx, network and authorization errors to distinct sanitized UI-safe results without returning provider bodies or logging message content/tokens. Do not retry a manual Gmail send after an ambiguous network outcome.

### MIME and manually confirmed message

Use Nodemailer’s MIME composer (add `nodemailer` and its TypeScript types) to generate RFC-compliant MIME, including encoded Unicode headers/body and a safe fixed `cv.pdf` filename for the optional attachment. Convert the completed RFC message to base64url for Gmail's `users.messages.send({ userId: 'me', requestBody: { raw } })`. Do not construct `From` from user input; omit it and let Gmail use the authenticated account. Validate recipient with the shared Zod email schema, subject length/content, non-empty plain-text body, PDF bytes through `validatePdfAttachment`, and bounded request size on the server. The Settings form requires an explicit attestation that the user controls the test destination and a final manual confirmation; the form never submits automatically on connection.

### Google configuration and account review

Document enabling Gmail API, configuring the OAuth consent screen and test users, creating a Web application OAuth client, and adding the exact redirect URI `http://localhost:3000/api/auth/google/callback` plus the deployed callback before deployment. The requested Gmail scope is sensitive and may require Google OAuth app verification for public use; local testing may require adding the user's Google account as a test user. Keep client secret and the 32-byte encryption key in server-only environment configuration.

### Approaches considered

1. **Store refresh tokens in `connected_accounts` encrypted columns:** simpler migration, but places long-lived secrets beside user-readable account metadata and increases the impact of future RLS/grant mistakes.
2. **Store tokens encrypted in a `private` schema and use only a service-role client from server-only routes:** feasible, but requires exposing that schema through PostgREST or broad direct table access to the privileged client.
3. **Private token table plus service-role-only narrow RPC wrappers (recommended):** keeps secrets out of user-readable rows and the API-exposed schema, makes metadata/token changes atomic, and limits privileged server operations to explicit functions. No user token operation goes through the browser.

---

## Files to Change

- Create: `supabase/migrations/20261023000500_phase5_google_oauth.sql` — one-active-account partial unique index, private encrypted token table, private manual-send records, owner/account constraints, per-user test-send rate limit, least-privilege grants, and service-role-only RPCs.
- Modify: `lib/database.types.ts` — add public RPC signatures and any new public connected-account metadata fields (do not expose private tables to client code).
- Modify: `lib/env.ts` — validate Google OAuth credentials, redirect URI, encryption key, and state-cookie configuration server-side only.
- Create: `lib/google/server.ts` — `server-only` Google OAuth/Gmail client factory and fixed scope/redirect setup.
- Create: `lib/google/oauth-state.ts` — random state/PKCE generation, HKDF-derived state-signing key, owner-bound cookie payload, expiry, callback verification, constant-time comparison, and cookie clearing.
- Create: `lib/google/token-crypto-core.ts` — testable AES-256-GCM encrypt/decrypt and AAD helpers using Node `crypto`.
- Create: `lib/google/token-crypto.ts` — server-only environment-bound wrapper around the core encryption helpers.
- Create: `lib/google/token-store.ts` — server-only token-secret RPC access and account status/update orchestration; must require a verified user and account from the RLS client.
- Create: `lib/google/errors.ts` — classify OAuth/Gmail failures and return sanitized stable error categories.
- Create: `lib/google/mime.ts` — build and base64url-encode plain-text MIME with an optional validated PDF.
- Create: `lib/google/gmail.ts` — refresh account credentials and call Gmail `users.messages.send` with no other Gmail APIs/scopes.
- Create: `app/api/auth/google/start/route.ts` — authenticated OAuth initiation.
- Create: `app/api/auth/google/callback/route.ts` — state/PKCE/session validation, code exchange, identity verification, token encryption, and connection upsert.
- Create: `app/api/gmail/connection/route.ts` — authenticated connection status read and POST disconnect; status only, no tokens.
- Create: `app/api/gmail/test-send/route.ts` — authenticated, rate-limited, Zod-validated, idempotent, explicitly confirmed single-message send.
- Modify: `app/settings/page.tsx` — replace placeholder with connection status, connect/disconnect, and manual test email form.
- Create: `components/gmail-settings.tsx` — client UI for safe connection state, confirmation, and sanitized result messages; contains no provider or secret logic.
- Modify: `lib/schemas.ts` — OAuth callback/test email request schemas, strict attachment/test confirmation schema, and bounded request fields.
- Modify: `package.json` and `package-lock.json` — add Nodemailer and its type package plus `test:phase5` script.
- Create: `tests/phase5-oauth.test.mts` — state, encryption, MIME, route guard/error mapping, and duplicate test-send unit coverage.
- Create: `supabase/tests/database/phase5_google_secrets.test.sql` — private schema grants, service-role function access, composite ownership constraints, and no-authenticated-access assertions.
- Modify: `README.md` — Google Cloud/Gmail API setup, OAuth test-user instructions, exact redirect URI, environment variables, verification warning, manual test flow, and remaining Phase 6 work.
- Modify: `.env.example` — retain safe placeholders and document exact server-only values; no actual keys.

## Interfaces

- `createGoogleOAuthClient(): OAuth2Client` is server-only and reads `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` from validated server environment.
- `createOAuthStartState(ownerId: string, encryptionKey: Uint8Array, now?: number): { state: string; codeVerifier: string; codeChallenge: string; signedStateCookie: string; expiresAt: number }` creates short-lived, owner-bound state and PKCE data; `verifyOAuthCallbackState(queryState, signedStateCookie, currentOwnerId, encryptionKey, now?: number): { valid: true; codeVerifierCookie: string } | { valid: false }` performs constant-time signature/state/session/expiry checks.
- `encryptRefreshToken(plaintext: string, ownerId: string, accountId: string, key: Uint8Array): EncryptedToken` returns ciphertext, nonce, tag, and key version; `decryptRefreshToken(encrypted, ownerId, accountId, key): string` authenticates the same owner/account context.
- `buildGmailRawMessage({ to, subject, text, attachment? }): Promise<string>` returns only the base64url Gmail `raw` payload; `attachment` contains validated bytes and the fixed download name.
- Private RPCs accept explicit owner/account IDs only from server code and are executable only by `service_role`; routes must first verify `supabase.auth.getUser()` and resolve the connection row through the user's RLS-scoped client.
- Test-send input includes a UUID `requestId`, one recipient, subject, text, a `confirmed: true` attestation, and optional one PDF. No batch/message ID or owner ID is accepted.

---

## Implementation Tasks

### Task 1: Add private persistence and token encryption primitives

**Files:**
- Create: `supabase/migrations/20261023000500_phase5_google_oauth.sql`
- Modify: `lib/database.types.ts`
- Create: `lib/google/token-crypto-core.ts`
- Create: `lib/google/token-crypto.ts`
- Test: `supabase/tests/database/phase5_google_secrets.test.sql`
- Test: `tests/phase5-oauth.test.mts`

**Interfaces:**
- Consumes the Phase 2 `private` schema conventions, `connected_accounts(owner_id,id)`, the server-only admin Supabase client, and the encryption interfaces above.
- Produces private token storage and test-send idempotency contracts for Tasks 2–4.

- [ ] **Step 1: Write failing crypto and schema security tests**

Test encryption/decryption round-trip, fresh nonce per encryption, wrong key, modified ciphertext/tag, owner AAD mismatch, account AAD mismatch, invalid key lengths, and unsupported key version. pgTAP asserts no `anon`/`authenticated` schema/table access, only `service_role` execute on wrapper functions, and cross-owner account IDs cannot be paired.

- [ ] **Step 2: Run targeted tests and confirm the missing behavior**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test tests/phase5-oauth.test.mts`
Run: `npm run db:test`
Expected: new crypto/database tests fail before implementation. If local Supabase is unavailable, record its exact startup failure and continue test-first with local-only checks later.

- [ ] **Step 3: Add the additive Phase 5 migration**

Drop the all-time unique-owner constraint on `connected_accounts` and add one-active-account-per-owner uniqueness. Preserve provider-subject global uniqueness and account rows for audit/history. Create `private.connected_account_tokens` with ciphertext/nonce/tag/key-version metadata, composite owner/account FK, timestamps, RLS enabled, and no user grants. Add service-role-only wrapper functions for atomic upsert/read/delete/status changes. Do not add token columns to the RLS-readable `connected_accounts` table. Add `private.gmail_test_sends` with owner/request uniqueness, safe outcome states, sanitized error category, and no recipient/body/token columns. Add atomic claim/finalize functions restricted to `service_role`. Extend `private.api_rate_limits.action` and its allowed-action check/function for `gmail_test`.

- [ ] **Step 4: Implement AES-256-GCM helpers**

Use Node `createCipheriv`/`createDecipheriv` with a random 12-byte nonce and 16-byte tag. Set AAD to a stable format such as `google-refresh:v1:{ownerId}:{accountId}`. Validate 32-byte keys and persisted binary lengths. Return a generic decrypt error and never include token/key values in thrown messages.

- [ ] **Step 5: Run Phase 5 pgTAP and crypto tests**

Expected: ciphertext round-trips only for the correct key and owner/account context, private data stays inaccessible to user roles, and wrapper calls reject mismatched owners.

### Task 2: Implement OAuth start, callback, and connection lifecycle

**Files:**
- Modify: `lib/env.ts`
- Create: `lib/google/server.ts`
- Create: `lib/google/oauth-state.ts`
- Create: `lib/google/token-store.ts`
- Create: `lib/google/errors.ts`
- Create: `app/api/auth/google/start/route.ts`
- Create: `app/api/auth/google/callback/route.ts`
- Create: `app/api/gmail/connection/route.ts`
- Modify: `lib/database.types.ts`
- Test: `tests/phase5-oauth.test.mts`

**Interfaces:**
- Consumes Task 1 encryption/storage primitives and existing `createUserSupabaseClient`, `createAdminSupabaseClient`, and `getAuthenticatedUser`.
- Produces safe connection metadata and OAuth connect/callback/disconnect routes; no route response includes a token.

- [ ] **Step 1: Add OAuth state/PKCE unit tests**

Cover valid callback, wrong/missing state, expired state, repeated callback after cookie clearing, PKCE challenge derivation, Supabase user ID mismatch, Google denial response, and cookie `HttpOnly`, `SameSite=Lax`, path, max-age, and production `Secure` attributes.

- [ ] **Step 2: Add server environment schema and Google OAuth client factory**

Validate client ID, client secret, exact redirect URI, and 64-character hexadecimal `TOKEN_ENCRYPTION_KEY` only in server code. Configure fixed scopes `openid`, `email`, and `gmail.send`; set response type code, offline access, PKCE S256, state, and consent prompt. Do not accept scopes or redirect URIs from request input.

- [ ] **Step 3: Implement authenticated OAuth start route**

Require verified Supabase user, create random state and PKCE verifier/challenge, set short-lived HttpOnly callback-scoped cookies, and redirect to Google. For missing session return a safe sign-in redirect; do not reveal environment values.

- [ ] **Step 4: Implement callback validation and code exchange**

On every callback path clear temporary cookies. Require a current Supabase user, code and state, valid unexpired matching state, matching initiating owner, and successful PKCE code exchange. Verify ID token against the configured client ID and obtain verified Google subject/email; verify granted scopes include `gmail.send` and contain no unrequested broad Gmail scopes.

- [ ] **Step 5: Store or reauthorize connection without losing tokens**

On the same Google subject, retain the current ciphertext if the response omits a refresh token; replace it only when a new refresh token is returned. On first connect, require a new refresh token before the metadata/token transaction commits. If another Google subject is already active for that owner, reject the callback and tell the user to disconnect the active account first. After disconnect, connecting a different subject creates a new historical account row; reconnecting a previously used subject reuses that owner's existing row. A subject already associated with another application user is rejected. Store Google subject and email as metadata, and never return token data.

- [ ] **Step 6: Implement connection status and disconnect**

Status GET uses the authenticated client and existing RLS read policy. Disconnect obtains the owned account ID from that client, decrypts token only server-side, attempts Google token revocation, then deletes local secret and marks metadata disconnected even if remote revocation fails. Return a sanitized result distinguishing locally disconnected from remote revocation confirmation; never log token or provider response.

- [ ] **Step 7: Test OAuth and lifecycle failure paths**

Mock token exchange and identity verification for invalid code, wrong audience, missing Gmail scope, missing refresh token, account identity conflict, Google denial, provider timeout, revocation failure, and repeated callback. Assert foreign account IDs return not-found and all responses omit secrets.

### Task 3: Build safe MIME and one-time manual test send

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `lib/google/mime.ts`
- Create: `lib/google/gmail.ts`
- Modify: `lib/schemas.ts`
- Create: `app/api/gmail/test-send/route.ts`
- Modify: `lib/google/errors.ts`
- Test: `tests/phase5-oauth.test.mts`
- Modify: `supabase/tests/database/phase5_google_secrets.test.sql`

**Interfaces:**
- Consumes the authenticated account lookup, token store, encryption, and idempotency RPCs from Tasks 1–2.
- Produces one manually initiated Gmail send operation; it never reads or mutates scheduled queue rows.

- [ ] **Step 1: Add MIME tests before implementation**

Assert generated raw messages are base64url, have valid multipart structure when a PDF exists, preserve Unicode subject/body, encode attachment bytes, use a safe fixed `cv.pdf` filename, omit user-controlled From, and do not allow CRLF subject/filename header injection.

- [ ] **Step 2: Add and use Nodemailer MIME composition**

Add Nodemailer plus its type definitions. Compose a plain-text message and optional validated PDF in memory, set only a server-derived Gmail From identity if required (otherwise omit From), and convert the complete RFC message to base64url for Gmail. Do not persist MIME or attachment contents.

- [ ] **Step 3: Add strict manual test-send validation**

Zod-validate a UUID request ID, recipient, subject, non-empty plain-text body, true explicit confirmation, and optional PDF. Bound body/request bytes; use `readBodyBytes` and `validatePdfAttachment`. Ignore filename/MIME as proof of PDF type and use a fixed MIME filename.

- [ ] **Step 4: Implement the server-only Gmail sender**

Resolve the current user's owned connected account, load and decrypt its refresh token through the restricted RPC, create a per-request OAuth client, refresh/get an access token, and call only Gmail `users.messages.send` with `userId: 'me'`. Do not persist access tokens. If the provider rotates a refresh token, encrypt and atomically store it. Map `invalid_grant` to revoked status and sanitize all other provider errors.

- [ ] **Step 5: Add atomic send idempotency and safe outcomes**

Before the Gmail call, claim `(owner_id, request_id)` in the private table. A duplicate `sending`, `sent`, or `uncertain` request ID returns its current safe state without a new Gmail request. Record `sent` only after Gmail returns a success response/provider message ID; record definite provider rejection as `failed`; record network ambiguity as `uncertain`. Never automatically retry an uncertain send.

- [ ] **Step 6: Test sending authorization and error handling**

Mock Gmail/OAuth to test no account, foreign account ID, expired access token with successful refresh, invalid refresh/revocation, 403, 429, 5xx, timeout after request dispatch, successful response, duplicate concurrent request IDs, malformed/oversized PDF, and no token/body in responses or captured logs.

### Task 4: Add Settings UI and Google Cloud setup documentation

**Files:**
- Modify: `app/settings/page.tsx`
- Create: `components/gmail-settings.tsx`
- Modify: `app/globals.css` only for focused Settings layout if existing styles are insufficient.
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes connection-status, disconnect, OAuth start, and test-send routes from Tasks 2–3.
- Produces accessible connection and explicit test-send UI with safe status/errors only.

- [ ] **Step 1: Add UI behavior tests for confirmation and no automatic send**

Verify that connecting does not submit test mail, the form requires recipient/subject/body and a control-of-address attestation, the optional attachment is only included after selection, and a second click reuses the same request ID while the request is pending.

- [ ] **Step 2: Implement Settings connection panel**

Show disconnected/connected/reconnect-required states and verified Google email. Provide Connect Gmail, Disconnect Gmail, and a Settings-only manual test form. Display a clear notice that batch scheduling does not send and no background worker exists yet. Use accessible labels, keyboard operation, busy state, confirmation, and sanitized errors. Never receive or render token fields.

- [ ] **Step 3: Add safe environment placeholders and setup documentation**

Document `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `TOKEN_ENCRYPTION_KEY` with placeholders only. Explain enabling Gmail API, OAuth consent screen/test users, Web OAuth client, exact localhost/deployed redirect URI, Gmail send scope, encryption-key generation/backup, and Google verification requirements. State that the encryption key must be identical for the web app and Phase 6 worker and that losing it makes stored refresh tokens unrecoverable.

### Task 5: Verify full Phase 5 boundary and report readiness

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Test: `tests/phase5-oauth.test.mts`
- Test: `supabase/tests/database/phase5_google_secrets.test.sql`

**Interfaces:**
- Consumes all Tasks 1–4 and produces tested connect/status/disconnect/manual-send behavior without changing the queue.

- [ ] **Step 1: Add the Phase 5 test script**

Add `test:phase5` using the repository's Node test runner and TypeScript strip-types flags, following Phase 3/4 script conventions. Unit tests use mocked Google clients and no production credentials. Local database tests run only against explicitly configured loopback Supabase.

- [ ] **Step 2: Verify queue behavior remains unchanged**

Run the Phase 4 queue tests and assert OAuth connect, token refresh, disconnect, and test email never change batch/message status or create `email_attempts`.

- [ ] **Step 3: Run requested checks**

Run: `npm run test:phase3`
Run: `npm run test:phase4`
Run: `npm run test:phase5`
Run: `npm run db:test`
Run: `npm run storage:test`
Run: `npm run lint`
Run: `npm run typecheck`
Run: `npm run build`

Expected: each available command exits 0. Report local Supabase/Google configuration-dependent tests honestly when services are unavailable; do not treat skipped tests as passed. Do not use real user Gmail credentials in automated tests.

- [ ] **Step 4: Inspect final diff and security boundary**

Review for browser imports of server-only modules, public token/select grants, missing RLS/owner checks, open redirect or callback URI input, unbounded request parsing, unsafe MIME headers, token/provider/body logging, duplicate send paths, automatic queue sends, false sent state, and unrelated edits.

- [ ] **Step 5: Document required user configuration and Phase 6 boundary**

Report files changed, whether a migration was added, commands and real results, Google Cloud actions the owner must complete, and remaining Phase 6 work: persistent worker, atomic message claims, inter-message interval enforcement during sends, leases/recovery, retries, uncertain delivery handling, and worker deployment. Confirm no bulk sending was implemented.

## Completion Criteria

- A signed-in user can connect exactly one active Google account for their own Supabase owner ID and see only safe connection metadata.
- OAuth uses authorization code, state, PKCE, offline access, the Gmail `gmail.send` scope, and identity-only OpenID/email claims.
- No refresh/access token, client secret, encryption key, or raw OAuth callback credential reaches the browser or logs.
- Refresh token ciphertext is authenticated, owner/account-bound, versioned, and inaccessible to `anon`/`authenticated` database roles.
- Disconnect attempts provider revocation and always removes local token availability while preserving account metadata for queue history.
- The user can deliberately send one plain-text test email with an optional valid PDF to an address they attest they control; duplicate request retries do not send twice under the same request ID.
- Gmail errors are sanitized; revoked tokens prompt reconnection; ambiguous sends remain uncertain and are not automatically retried.
- Existing import, PDF storage, and queue scheduling remain unchanged; no batch is automatically sent and no worker is implemented.
- Lint, typecheck, automated tests, and build results are recorded accurately.
