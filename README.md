# Correspond — Email Scheduler

Correspond is a multi-user-ready foundation for preparing, scheduling, and tracking personalized outreach. Phase 1 provides an accessible dashboard shell and shared validation schemas only. Sign-in, data persistence, import, Gmail connection, and sending are not implemented.

## Stack

- Next.js App Router, React, and TypeScript
- Tailwind CSS
- Supabase Auth and PostgreSQL, planned for durable user-owned data
- Supabase private Storage, planned for shared PDF attachments
- Google OAuth 2.0 and Gmail API, planned for per-user sending
- A separate persistent Node.js/TypeScript worker, planned for scheduled delivery
- Zod for runtime input validation and `csv-parse` for a later import phase

## Local development

Use npm, as indicated by `package-lock.json`.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The four dashboard destinations currently explain which capabilities are planned. There are no operational email, account, or queue controls.

## Checks

```bash
npm run lint
npm run typecheck
npm run build
```

There is currently no test script. Do not use production credentials for local checks.

## Planned architecture and trust boundaries

The Next.js web app will own the dashboard, import and preview flow, scheduling interface, history, and controls. Supabase Auth will provide each user's stable owner ID. Every future batch, message, attempt, attachment, and Gmail connection must be scoped to that ID. The server must authorize each operation, and PostgreSQL RLS and restrictive Storage policies must enforce the same ownership boundary. A client-supplied owner ID is never proof of ownership.

The Supabase service-role key bypasses RLS. Keep it on trusted server or worker processes only and pair privileged operations with explicit ownership checks. Never expose it or OAuth credentials in browser code or `NEXT_PUBLIC_*` variables.

Each application user will have one Gmail connection. OAuth state and callbacks must be validated, refresh tokens encrypted at rest, and token refresh/revocation handled server-side. The persistent worker will select the Gmail connection belonging to the owner of each queued message. It will use durable database state, atomically claim due work, and recover through leases; browser timers and long-running web requests will not send scheduled mail.

## Current phase limits

Phase 1 does not implement authentication or authorization, database access or migrations, RLS or Storage policies, CSV/JSON import, attachment upload, batch persistence, Gmail OAuth, email sending, queue controls, or worker behavior. The shell is not private and must not be treated as protected or deployed with private user data.

## Before public registration or production use

- Configure Supabase Auth, session handling, and registration policy.
- Add migrations, owner-scoped foreign keys, RLS policies, server-side authorization, and private Storage policies.
- Add request-size and rate limits to sensitive endpoints; validate external input on the server.
- Configure per-user Google OAuth consent and redirect handling; encrypt refresh tokens with a server-side key and keep credentials out of logs and browser code.
- Deploy the web app and persistent worker separately. Configure secrets, worker health checks, leases and crash recovery, backups, and sanitized logs.
- Verify pause, cancel, skip, retry, and uncertain-send handling before enabling bulk scheduling.
- Run an end-to-end check with a tiny batch sent to an address controlled by the owner before any real outreach.

## Configuration hygiene

`.env.example` contains variable names and safe placeholder values. Copy it to `.env.local` when a later integration phase needs configuration; `.env.local`, private keys, token files, and local upload directories are ignored by Git. Never commit real credentials or uploaded CVs.

## Project layout

- `app/` — dashboard routes and global styles
- `components/` — shared dashboard shell and honest section placeholders
- `lib/schemas.ts` — Zod input and status schemas
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
