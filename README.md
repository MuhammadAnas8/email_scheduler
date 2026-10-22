# Correspond — Email Scheduler

A private, single-user workspace for preparing, scheduling, and tracking personalized outreach. The first setup phase provides the app shell and shared validation foundations; integrations and sending are not enabled yet.

## Stack

- Next.js App Router, React, and TypeScript
- Tailwind CSS
- Zod for shared input schemas
- Supabase, Google OAuth/Gmail, and a separate persistent worker in later phases

## Local development

Use npm, as indicated by `package-lock.json`.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The dashboard currently shows setup progress only. Batch creation, account connection, and sending are intentionally not available in this phase.

## Checks

```bash
npm run lint
npm run typecheck
npm run build
```

## Configuration

No service configuration is needed to view the current app shell. When beginning the relevant integration phases, copy `.env.example` to `.env.local` and fill in the values in your local environment. Keep real credentials out of Git and browser code. Do not use production credentials for local checks.

The next project phase is the Supabase database foundation. It will add version-controlled migrations and server-only database access. Gmail authorization and scheduled sending come later; scheduled delivery will require a separately deployed persistent worker.

## Project layout

- `app/` — Next.js dashboard and global styles
- `lib/schemas.ts` — Zod input schemas shared by app layers
- `lib/types.ts` — batch and message status types
- `worker/` — reserved for the persistent sender in a later phase

## Security notes

This app is intended for one owner. The dashboard is a visual shell and does not yet implement authentication or private routes. Do not deploy it with private data until access control is implemented. `.env.local`, credentials, and local uploaded files are ignored by Git.
