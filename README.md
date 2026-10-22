# Correspond — Email Scheduler

Correspond is a multi-user-ready app for preparing personalized outreach. Phase 5 provides cookie-backed Supabase sign-in, private CSV/JSON import and review, owner-scoped durable queue scheduling and controls, per-user Gmail OAuth, encrypted refresh-token storage, and one explicitly confirmed manual test email. Scheduled sending and the persistent worker are not implemented.

## Stack

- Next.js App Router, React, and TypeScript
- Tailwind CSS
- Supabase Auth and PostgreSQL for durable user-owned drafts
- Supabase private Storage for shared PDF attachments
- Google OAuth 2.0 and Gmail API for per-user connection and manual test sends
- A separate persistent Node.js/TypeScript worker, planned for scheduled delivery
- Zod for client and server validation and `csv-parse` for CSV import

## Local development

Use npm, as indicated by `package-lock.json`.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in with an administrator-provisioned Supabase Auth user; public registration is disabled in the local Supabase config. The New Batch flow imports CSV/JSON, validates and edits each row, optionally uploads one CV PDF, and saves a draft.

## Checks

```bash
npm run lint
npm run typecheck
npm run build
```

Run `npm run test:phase3`, `npm run test:phase4`, and `npm run test:phase5` for import, queue, OAuth-state, token-crypto, MIME, and idempotency unit checks. Queue integration tests require the explicitly configured loopback test environment. Database and Storage pgTAP/integration checks require an available test database; do not use production credentials for tests.

## Planned architecture and trust boundaries

The Next.js web app will own the dashboard, import and preview flow, scheduling interface, history, and controls. Supabase Auth will provide each user's stable owner ID. Every future batch, message, attempt, attachment, and Gmail connection must be scoped to that ID. The server must authorize each operation, and PostgreSQL RLS and restrictive Storage policies must enforce the same ownership boundary. A client-supplied owner ID is never proof of ownership.

The Supabase service-role key bypasses RLS. Keep it on trusted server or worker processes only and pair privileged operations with explicit ownership checks. Never expose it or OAuth credentials in browser code or `NEXT_PUBLIC_*` variables.

Each application user has at most one active Gmail connection. OAuth state, PKCE, and callbacks are validated; refresh tokens are encrypted at rest; and token refresh/revocation stay server-side. Phase 5 supports only a manually confirmed single test email. The future persistent worker must select the Gmail connection belonging to each queued message, atomically claim durable queue work, and recover through leases; browser timers and long-running web requests will not send scheduled mail.

## Current phase limits

The app implements authentication and authorization, owner-scoped database access, RLS and Storage policies, CSV/JSON import, private attachment upload, draft persistence, queue scheduling, pause/resume/cancel/skip controls, history, Gmail OAuth, encrypted token storage, and a manual test-send path. Scheduled queue state is durable, but no worker claims or sends queued messages. Automatic retries and worker behavior are not implemented. The Phase 5 migration is `supabase/migrations/20261023000500_phase5_google_oauth.sql`; the connected Supabase repository integration applies migrations.

## Before public registration or production use

- Review Supabase Auth session settings and keep public registration disabled until launch controls are ready.
- Apply the versioned migrations and verify owner-scoped foreign keys, RLS policies, server-side authorization, and private Storage policies against the intended Supabase project.
- Add platform/IP-level rate limits before public launch. Import, draft, and attachment APIs already use atomic per-user, per-minute database limits; sign-in uses Supabase Auth limits.
- Complete [Phase 5 Google Cloud and environment setup](docs/phase-5-gmail-oauth-setup.md), including an OAuth test user, exact callback URL, and secure encryption-key backup.
- Deploy the web app and persistent worker separately. Configure secrets, worker health checks, leases and crash recovery, backups, and sanitized logs.
- Verify pause, cancel, and skip against the intended Supabase project. Retry and uncertain-send handling require the later worker phase.
- Run a manual test email to an address controlled by the owner before beginning any future sending phase.

## Configuration hygiene

`.env.example` contains variable names and safe placeholder values. Copy it to `.env.local` when local integrations need configuration; `.env.local`, private keys, token files, and local upload directories are ignored by Git. Never commit real credentials or uploaded CVs.

Phase 5 external setup steps are documented in [docs/phase-5-gmail-oauth-setup.md](docs/phase-5-gmail-oauth-setup.md).

## Project layout

- `app/` — dashboard routes and global styles
- `components/` — dashboard shell and import/preview workflow
- `lib/` — shared schemas, CSV/JSON parsing, PDF validation, and server-only Supabase clients
- `lib/types.ts` — shared batch/message statuses and import record shape
- `worker/` — reserved for the persistent sender in a later phase
- `docs/superpowers/` — design specs and implementation plans

# Phase 2: Supabase database foundation

The database foundation uses Supabase Auth UUIDs as row owners and applies ownership checks in PostgreSQL. The local stack uses a dedicated project slug and ports (`55420`–`55429`) so it can coexist with another local Supabase project. No hosted project is linked by this repository.

## Local prerequisites and setup

- Node.js and npm (use `npm ci` for the lockfile-defined dependencies).
- Supabase CLI and Docker Desktop with its Linux container engine running.

Start the local services and apply the ordered migrations:

```powershell
npx supabase start
```

The migrations create `connected_accounts`, `email_batches`, `scheduled_emails`, and `email_attempts`; enforce composite owner relationships and status transitions; enable owner-scoped RLS; and create the private `cv-attachments` bucket. The bucket accepts `application/pdf` up to 10 MiB and permits access only to `{owner_id}/{batch_id}/cv.pdf` when that batch belongs to the signed-in owner. Database deletion does not remove a Storage object; a later deletion workflow must handle both resources.

Run database and Storage isolation checks against this local stack:

```powershell
npm run db:test
npm run storage:test
```

The Storage test reads local connection values from `supabase status`; it refuses non-loopback endpoints and requires this repository's local port `55421`. Do not provide hosted or production credentials to tests.

Regenerate the TypeScript database schema after changing a migration:

```powershell
npm run db:types
```

For an explicitly disposable local database only, replay all migrations with:

```powershell
npx supabase db reset
```

This command destroys local database data. Check the active project and local data first. Never run a linked or hosted reset. For hosted development, staging, or production, review migration SQL and apply it through the intended project's approved migration process; this Phase 2 setup does not link a remote project or push migrations.

## Server environment

Copy `.env.example` to `.env.local` for server-side app configuration and replace placeholders only with the intended local values. `SUPABASE_SERVICE_ROLE_KEY` is privileged and must remain server-only; it is used only by the isolated admin client or local test fixture setup. The ordinary user client uses the anon key and request cookies, and scheduler reads rely on RLS. There is no browser Supabase client in this phase.

Google OAuth, email sending, import/upload flows, and the persistent worker are not implemented in Phase 2. The connected-account table intentionally has no token columns. A later Gmail phase must store refresh-token ciphertext, nonce, authentication tag, and key version in a private schema/table with no user grants, encrypt/decrypt only in trusted server or worker code, and manage the encryption key outside PostgreSQL with a rotation and recovery plan.

## Phase 3: import, preview, and draft storage

- Sign in at `/login` with an administrator-provisioned Supabase Auth user. Public signup is disabled in `supabase/config.toml`.
- The Phase 3 migration adds an authenticated draft creation RPC, allows draft messages to remain unscheduled, adds per-user API rate limits, and removes direct authenticated Storage writes so CV uploads pass through the server validator. The Phase 4 migration adds ordered messages and authenticated atomic queue lifecycle RPCs. Apply migrations through the repository's configured Supabase integration, or use `npx supabase migration up --local` when an already-running local stack is intentionally available.
- Run import/PDF unit tests with `npm run test:phase3`; run database and Storage isolation suites with `npm run db:test` and `npm run storage:test`.
- CSV imports require `recipient`, `subject`, and `body` headers; JSON imports require an array of those records. Imports are limited to 2 MiB and 200 messages.
- The app validates on the client for immediate feedback and validates again on the server. The server checks PDF bytes and a 10 MiB size limit without relying on the filename or browser MIME value.
- The workflow saves drafts and can confirm durable queue scheduling. Messages do not send in this phase; Gmail OAuth and background processing remain for later phases.
