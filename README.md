# Correspond — Email Scheduler

Correspond is a multi-user-ready app for preparing personalized outreach. Phase 4 provides cookie-backed Supabase sign-in, private CSV/JSON import and review, owner-scoped draft persistence, private shared CV uploads, and durable queue scheduling and controls. Gmail connection, sending, and the persistent worker are not implemented.

## Stack

- Next.js App Router, React, and TypeScript
- Tailwind CSS
- Supabase Auth and PostgreSQL for durable user-owned drafts
- Supabase private Storage for shared PDF attachments
- Google OAuth 2.0 and Gmail API, planned for per-user sending
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

Run `npm run test:phase3` for import, authorization-guard, request-size, and PDF validation tests. Run `npm run test:phase4` for schedule helper and queue integration tests. The queue integration test skips with a clear reason unless the explicit local-only `PHASE4_TEST_SUPABASE_URL`, `PHASE4_TEST_SUPABASE_ANON_KEY`, and `PHASE4_TEST_SUPABASE_SERVICE_ROLE_KEY` variables are set; it rejects non-loopback URLs and never loads `.env.local`. Database and Storage pgTAP/integration checks require the local Supabase stack. Do not use production credentials for local checks.

## Planned architecture and trust boundaries

The Next.js web app will own the dashboard, import and preview flow, scheduling interface, history, and controls. Supabase Auth will provide each user's stable owner ID. Every future batch, message, attempt, attachment, and Gmail connection must be scoped to that ID. The server must authorize each operation, and PostgreSQL RLS and restrictive Storage policies must enforce the same ownership boundary. A client-supplied owner ID is never proof of ownership.

The Supabase service-role key bypasses RLS. Keep it on trusted server or worker processes only and pair privileged operations with explicit ownership checks. Never expose it or OAuth credentials in browser code or `NEXT_PUBLIC_*` variables.

Each application user will have one Gmail connection. OAuth state and callbacks must be validated, refresh tokens encrypted at rest, and token refresh/revocation handled server-side. The persistent worker will select the Gmail connection belonging to the owner of each queued message. It will use durable database state, atomically claim due work, and recover through leases; browser timers and long-running web requests will not send scheduled mail.

## Current phase limits

The app implements authentication and authorization, owner-scoped database access, RLS and Storage policies, CSV/JSON import, private attachment upload, draft persistence, queue scheduling, pause/resume/cancel/skip controls, history, and derived queue counts. Scheduled queue state is durable, but no worker claims or sends messages. Gmail OAuth, email sending, retries, and worker behavior are not implemented. Apply `supabase/migrations/20261023000400_phase4_queue_controls.sql` through the repository's configured Supabase migration integration; no migration is applied by these app checks.

## Before public registration or production use

- Review Supabase Auth session settings and keep public registration disabled until launch controls are ready.
- Apply the versioned migrations and verify owner-scoped foreign keys, RLS policies, server-side authorization, and private Storage policies against the intended Supabase project.
- Add platform/IP-level rate limits before public launch. Import, draft, and attachment APIs already use atomic per-user, per-minute database limits; sign-in uses Supabase Auth limits.
- Configure per-user Google OAuth consent and redirect handling; encrypt refresh tokens with a server-side key and keep credentials out of logs and browser code.
- Deploy the web app and persistent worker separately. Configure secrets, worker health checks, leases and crash recovery, backups, and sanitized logs.
- Verify pause, cancel, and skip against the intended Supabase project. Retry and uncertain-send handling require the later worker phase.
- Run an end-to-end check with a tiny batch sent to an address controlled by the owner before any real outreach.

## Configuration hygiene

`.env.example` contains variable names and safe placeholder values. Copy it to `.env.local` when a later integration phase needs configuration; `.env.local`, private keys, token files, and local upload directories are ignored by Git. Never commit real credentials or uploaded CVs.

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
