# Email Scheduler — Codex Project Instructions

## 1. Project goal

Build a secure, single-user web application for preparing, scheduling, sending, and tracking personalized emails from one Gmail account. The main use case is legitimate, individualized outreach (for example, contacting professors about research or study opportunities).

The application must continue scheduled sending when the user's laptop is off. Therefore, sending must happen in a persistent cloud worker, not in the browser, a browser timer, or a long-running Next.js request.

## 2. Required stack

- Next.js App Router with TypeScript and React.
- Tailwind CSS for styling.
- Supabase PostgreSQL for durable application data.
- Supabase private Storage for uploaded CV/PDF attachments.
- Google OAuth 2.0 and Gmail API for sending from one connected Gmail account.
- A separate persistent Node.js/TypeScript worker deployed as a background service (for example, a Render Background Worker).
- Zod for runtime validation.
- `csv-parse` for CSV import.
- Use the package manager already indicated by the repository lockfile. Do not switch package managers.

Do not add a queue product, Redis, or another database unless there is a clear technical reason and the user approves it.

## 3. Product requirements

### Single-user access
- This is a personal tool for one owner, not a public multi-user SaaS.
- Protect the dashboard and all private API routes.
- Do not assume that hiding a button is access control.
- Keep service-role keys, OAuth client secrets, refresh tokens, and other secrets on the server only.
- Never put secrets in `NEXT_PUBLIC_*` variables, client components, browser logs, or Git.
- Use the least-privilege approach available. Document any temporary development-only authentication shortcuts and remove them before production.

### Import and preview
- Accept CSV and JSON files.
- Each email record contains `recipient`, `subject`, and full plain-text `body`.
- Validate every record and show row-level errors before scheduling.
- Reject malformed addresses, missing fields, empty bodies, unsupported file formats, and batches above 200 emails.
- Show a preview of every message before the user confirms the batch.
- Let the user edit individual records and remove invalid/unwanted records before confirmation.
- One shared CV PDF may be attached to every message in a batch.
- Validate attachment type and size; store the PDF in a private Supabase Storage bucket and use short-lived signed URLs only when needed.
- Do not log email bodies, OAuth tokens, or attachment contents.

### Scheduling and controls
- Allow a batch to start immediately or at a user-selected future date/time.
- Store all timestamps in UTC; convert to/from the user's local timezone in the UI.
- Allow a configurable fixed interval of 5–10 seconds between send attempts.
- Support pause, resume, cancel batch, and skip individual queued messages.
- Changes must be persisted in the database so they survive restarts and deployments.
- Make controls safe against race conditions and repeated clicks.
- A cancelled batch must not claim new messages. A message already being sent may need to finish; explain this in the UI.

### History
- Keep batches, message statuses, and attempt history indefinitely unless the owner explicitly deletes them.
- Provide batch-level counts and per-message status/error details.
- Support deletion with confirmation. Explain what is deleted and whether provider-side sent mail remains in Gmail.

### Reliability
- Use durable database-backed queue state; do not rely on in-memory state as the source of truth.
- Start with one active sender/worker to preserve predictable ordering and spacing.
- Claim due messages atomically in PostgreSQL, preferably through a narrowly scoped SQL function/RPC and a transaction-safe locking strategy.
- Use leases/heartbeats or equivalent recovery so messages stuck in `sending` can be detected after a worker crash.
- Record each attempt with timestamps, outcome, provider message ID when available, and a sanitized error.
- Retry only clearly transient failures (such as a rate limit or temporary service failure), using bounded exponential backoff and `Retry-After` where supplied.
- Do not blindly retry a send whose outcome is uncertain (for example, the request may have reached Gmail but the response was lost). Mark it `uncertain` and provide a manual resolution path to avoid duplicate emails.
- Do not claim Gmail provides exactly-once delivery or a general idempotency guarantee.
- Respect Gmail API quotas and account sending limits. The 5–10 second interval is not a way to bypass quotas or anti-abuse controls. Stop and surface errors when the account or API indicates sending is not allowed.
- Never implement spam evasion, sender rotation, account rotation, or limit bypasses.

## 4. Suggested architecture

### Web app (Next.js)
- Owns the dashboard, batch creation, CSV/JSON import, validation, preview, scheduling, history, and controls.
- Uses server-side code for privileged database operations.
- Does not send the scheduled batch from a browser or a normal API route.

### Database and storage (Supabase)
Create migrations for:
1. `email_batches`
2. `scheduled_emails`
3. `email_attempts`
4. `connected_accounts`

Recommended concepts:
- Batch statuses: `draft`, `scheduled`, `running`, `paused`, `completed`, `cancelled`, `failed`.
- Message statuses: `pending`, `sending`, `sent`, `retrying`, `failed`, `skipped`, `uncertain`.
- Batch fields should include ID, name, status, start time, interval, totals/counters, creation time, and completion time.
- Message fields should include batch ID, recipient, subject, plain-text body, status, scheduled time, attempt count, next attempt time, lease information, provider message ID, last error, sent time, and a stable internal ID.
- Attempt fields should include message ID, attempt number, start/end time, outcome, sanitized error, and provider message ID.
- Connected account fields should identify the Gmail address and store refresh-token data securely.
- Add foreign keys, check constraints, indexes for queue polling/history, and Row Level Security where appropriate.
- Use SQL migrations committed to the repository. Do not rely on undocumented manual dashboard edits.
- Design status transitions and counter updates to be transaction-safe; avoid duplicate increments.

### Persistent worker
- Keep worker code separate from Next.js route handlers, for example in `worker/`.
- Use Node.js and TypeScript.
- Poll or otherwise claim due work from Supabase using an atomic database operation.
- Enforce batch state, schedule time, and inter-message interval before sending.
- Persist state before and after provider calls.
- Handle graceful shutdown and release/expire leases safely.
- The worker must be deployable as a persistent background service and documented separately from Vercel deployment.
- Use a single worker initially; do not increase concurrency without explicit design/testing.

### Gmail integration
- Use Google OAuth 2.0 and Gmail API with the minimum scopes needed to send messages.
- Use the OAuth authorization-code flow with secure state validation.
- Store refresh tokens encrypted at rest using a server-side encryption key, or use an explicitly documented secure secret-management design. Never store them in plaintext.
- Provide connect, connection-status, and disconnect/revoke flows.
- Refresh access tokens securely and handle revocation/expiry.
- Build MIME messages correctly for plain-text content and a PDF attachment. Correctly encode filenames, headers, Unicode, and base64url message bodies.
- Do not create misleading sender identities or spoof From headers.

## 5. Security and privacy rules

- Add `.env.example` with variable names and safe placeholders only.
- Ensure `.env.local`, private keys, tokens, and uploaded CVs are ignored by Git.
- Validate all external input on the server with Zod, even if the UI validates it too.
- Check ownership/authorization on every route and database operation.
- Use private Storage buckets, restrictive RLS policies, and short-lived signed URLs.
- Never expose the Supabase service-role key to the browser.
- Sanitize provider errors before displaying or storing them.
- Avoid logging personal data and message bodies.
- Add request size limits and reasonable rate limits to sensitive endpoints.
- Do not hard-code credentials or production URLs.
- Do not use production credentials in tests.

## 6. UI expectations

Build a clean, responsive dashboard with:
- Overview cards: queued, sent, failed, skipped, and uncertain.
- New batch flow: upload/import, map/validate fields if needed, preview/edit, choose start time/interval, attach CV, confirm.
- Batch details: progress, pause/resume/cancel controls, message list, per-message status, skip action, retry/error details.
- Gmail connection status and a clear disconnect action.
- History/search and deletion confirmation.
- Accessible labels, keyboard navigation, useful empty/loading/error states, and responsive layouts.
- Avoid fake functionality. If a feature is not implemented, label it as not implemented rather than showing a control that does nothing.

## 7. Engineering workflow for Codex

Before implementing a major feature:
1. Inspect the existing repository and its package scripts.
2. Summarize the current structure and propose the smallest safe next step.
3. Keep changes incremental and focused.
4. Add or update tests for important behavior.
5. Run lint, type-check, and tests when scripts are available.
6. Report commands run, results, files changed, and remaining risks.
7. Never claim a test or deployment succeeded unless it actually ran and succeeded.

Do not overwrite user changes, reset Git history, or run destructive database/file commands without asking first. Do not install large or unrelated dependencies without explaining why.

## 8. Implementation phases

Work in these phases and stop at the end of each phase for review unless the user explicitly asks to continue:

### Phase 1 — Inspect and scaffold
- Inspect the repository.
- Set up the app shell, dashboard navigation, shared types, Zod schemas, environment example, formatting/lint/type-check scripts, and README.
- Do not connect Gmail or send email yet.

### Phase 2 — Database foundation
- Add version-controlled Supabase SQL migrations, constraints, indexes, and RLS policies.
- Add server-only Supabase clients and typed data-access helpers.
- Document how to apply migrations.

### Phase 3 — Import and preview
- Implement CSV/JSON parsing, validation, row-level errors, editable preview, 200-message limit, and shared PDF upload.
- Do not send email yet.

### Phase 4 — Queue and controls
- Implement batch/message persistence and safe state transitions.
- Add unit/integration tests for pause, resume, cancel, skip, scheduling, counters, and duplicate clicks.
- Do not connect Gmail yet.

### Phase 5 — Gmail OAuth and sending
- Implement OAuth securely, token encryption, MIME generation, and a manual single-message test flow.
- Verify Gmail scopes and consent-screen configuration.
- Do not begin bulk sending until manual sending is verified.

### Phase 6 — Persistent worker
- Implement atomic claims, interval enforcement, retries, leases, uncertain outcomes, and graceful shutdown.
- Test worker restarts and failure scenarios locally.

### Phase 7 — Deployment and hardening
- Deploy web app and persistent worker separately.
- Configure secrets, OAuth redirect URLs, Supabase policies, logs, health checks, and backups.
- Run an end-to-end test with a tiny batch to an address controlled by the owner before any real outreach.

## 9. First task to perform

Start with Phase 1 only. Inspect the repository before editing. If it is empty or a standard Next.js starter, scaffold the app shell and documentation without adding Gmail sending or worker behavior yet. Then run available checks and report what was completed and what the user must configure next.

Design the application as multi-user-ready from the beginning, even if the initial deployment is private.

- Use Supabase Auth and a stable user ID.
- Scope batches, messages, attachments, and Gmail connections to their owner.
- Enforce ownership with server-side authorization and Supabase Row Level Security.
- Store Gmail OAuth credentials securely per user.
- Ensure the worker selects the correct Gmail connection for every queued message.
- Never implement a global Gmail account shared by all users.
- Keep the initial implementation simple: support one connected Gmail account per application user and one active sender initially.
- Do not add unnecessary team features, organizations, billing, or complex role systems yet.
- Document which steps are still required before public registration and production launch.