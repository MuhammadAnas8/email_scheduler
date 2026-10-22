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
