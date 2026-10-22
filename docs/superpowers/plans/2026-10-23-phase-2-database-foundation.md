# Phase 2 Multi-user Database Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible Supabase database foundation that enforces per-user ownership across scheduler records and private CV Storage.

**Architecture:** Use Supabase Auth UUIDs as `owner_id`, composite ownership foreign keys, and RLS policies on every user-owned table. Keep ordinary reads on a cookie-aware server client; isolate the service-role client behind a server-only module, and use pgTAP against a local Supabase stack to exercise tenant boundaries.

**Tech Stack:** Supabase PostgreSQL, Supabase CLI, pgTAP, Next.js App Router, TypeScript, `@supabase/ssr`, `@supabase/supabase-js`, npm.

**Spec:** `docs/superpowers/specs/2026-10-23-phase-2-database-foundation-design.md`

## Global Constraints

- Use Supabase PostgreSQL and private Supabase Storage.
- Use `auth.users.id` as the stable owner ID for every user-owned row.
- Use ordered, version-controlled SQL migrations; do not rely on manual dashboard edits.
- Keep service-role keys, OAuth secrets, refresh tokens, and other secrets on trusted server/worker processes only.
- Never put secrets in `NEXT_PUBLIC_*` variables, client components, browser logs, or Git.
- Do not implement Gmail OAuth, email sending, or the persistent worker in this phase.
- Do not add a queue product, Redis, or another database.
- Use npm, as indicated by `package-lock.json`.
- Never apply or reset migrations on a linked/production database as part of local verification.

## Review Focus

- **Cross-user reads:** user A must not read user B's rows in any of the four tables; pin both directions with pgTAP under authenticated JWT claims.
- **Spoofed or changed ownership:** a user must not insert/update rows as another owner or change `owner_id`; pin policy and trigger rejection with pgTAP.
- **Cross-owner relationships:** a row owned by A must not reference B's batch, message, or connected account; pin composite FK rejection with pgTAP.
- **Invalid states and values:** invalid status transitions, terminal-state changes, out-of-range intervals, malformed attachment paths, and invalid attempt timestamps must fail; pin each with pgTAP.
- **Storage and credential boundary:** another user or an unowned batch path must not access a CV object, and service-role configuration must not enter client bundles; exercise Storage policies through the local Storage API and verify server-only boundaries through build/import checks and static bundle inspection.

---

### Task 1: Local Supabase configuration and core schema

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/20261023000100_core_schema.sql`

**Interfaces:**
- Tables: `public.email_batches`, `public.scheduled_emails`, `public.email_attempts`, `public.connected_accounts`.
- Every table exposes `owner_id uuid NOT NULL` referencing `auth.users(id)` and a unique `(owner_id, id)` key for composite references.

- [ ] **Step 1: Configure a local Supabase project** in `supabase/config.toml`; enable local database testing with pgTAP and use a deterministic project slug without any production project reference or credential.
- [ ] **Step 2: Create `connected_accounts`** with UUID primary key, `owner_id`, provider fixed to Google, stable provider subject, display Gmail address, connection status/timestamps, `UNIQUE(owner_id)`, `UNIQUE(provider, provider_subject)`, and `UNIQUE(owner_id, id)`; do not add token columns.
- [ ] **Step 3: Create `email_batches`** with owner, name, status default `draft`, nullable `starts_at`, `interval_seconds smallint`, nullable `connected_account_id`, nullable `attachment_path`, created/updated/completed times, and `UNIQUE(owner_id, id)`.
- [ ] **Step 4: Create `scheduled_emails`** with owner, batch, recipient, subject, plain-text body, status default `pending`, scheduled/next-attempt times, non-negative `attempt_count`, lease token/expiry, provider message ID, sanitized last error, sent/created/updated times, and `UNIQUE(owner_id, id)`.
- [ ] **Step 5: Create `email_attempts`** with owner, scheduled email ID, positive attempt number, start/end times, outcome, sanitized error, provider message ID, and unique `(owner_id, scheduled_email_id, attempt_number)`.
- [ ] **Step 6: Add ownership-safe composite foreign keys** from batch to connected account, message to batch, and attempt to message; use `ON DELETE CASCADE` from owner to user data and batch to messages/attempts, and prevent account deletion from invalidating historical batch references.
- [ ] **Step 7: Add value constraints and indexes:** exact status sets from `lib/types.ts`, trimmed non-empty names/subject/body, interval 5–10 seconds, valid attempt time ordering, attachment path exactly `{owner_id}/{batch_id}/cv.pdf`, owner history indexes, message-by-batch ordering index, and a partial due-message index for `pending`/`retrying` states.
- [ ] **Step 8: Add status transition and owner immutability triggers** for the transition graphs in the approved spec; reject all unlisted edges and prevent updates that change an existing row's `owner_id`. Keep trigger functions `SECURITY INVOKER` and set a safe `search_path`.
- [ ] **Step 9: Verify the schema migration applies to a fresh, isolated local Supabase database**; expected result is all core tables, constraints, indexes, and triggers created without a linked project. Use `supabase db reset` only after confirming the target is a disposable local database with no user data; never reset a linked database.

### Task 2: RLS, grants, private CV bucket, and tenant tests

**Files:**
- Create: `supabase/migrations/20261023000200_rls_storage.sql`
- Create: `supabase/tests/database/phase2_tenant_isolation.test.sql`
- Create: `scripts/storage-policy.test.mjs`

**Interfaces:**
- RLS uses `owner_id = auth.uid()` for row access.
- CV object paths use `{owner_id}/{batch_id}/cv.pdf` in the private bucket `cv-attachments`.

- [ ] **Step 1: Write pgTAP assertions for two authenticated users** with separate JWT subject claims; assert each user sees own rows and zero rows owned by the other user in all four tables.
- [ ] **Step 2: Write pgTAP assertions for forbidden writes and relationships:** spoofed owner inserts, owner changes, direct message/attempt/account writes, and cross-owner composite references must fail.
- [ ] **Step 3: Write pgTAP assertions for constraints and transitions:** invalid status values/edges, updates from terminal states, interval outside 5–10, malformed CV object path, negative attempts, and end-before-start must fail.
- [ ] **Step 4: Add RLS policies to all public tables** for `authenticated`; allow owner-only selects, owner-only draft batch inserts/updates, and owner-only batch deletes; provide no authenticated DML policy for scheduled emails, attempts, or connected account metadata.
- [ ] **Step 5: Set explicit SQL grants**: revoke unintended table privileges from `anon` and `authenticated`, grant authenticated `SELECT` on the four tables, and grant only the intended `INSERT`/`UPDATE`/`DELETE` operations on `email_batches`; preserve the intended trusted service-role access.
- [ ] **Step 6: Add bucket configuration and `storage.objects` policies** in migration SQL; create private `cv-attachments` with `application/pdf` and a 10 MiB cap, compare the first folder to `auth.uid()`, and require the second component to reference a batch owned by that user. Do not directly insert/update/delete Storage object metadata from SQL; do not permit overwrite/update if uploads use unique deterministic paths.
- [ ] **Step 7: Run `supabase test db`** against the local stack; expected result is all pgTAP table, FK, constraint, grant, and transition assertions pass for both user identities and denied operations.
- [ ] **Step 8: Add a local Storage API integration test** in `scripts/storage-policy.test.mjs`; use temporary local test users and `@supabase/supabase-js` to verify user A can upload/read/delete only the owned batch path and user B cannot list/download/delete it or upload against A's batch. Create/clean fixtures through Auth/Storage APIs and admin-only fixture setup, never direct SQL mutation of `storage.objects`.
- [ ] **Step 9: Run the Storage policy test** against the local Supabase HTTP endpoints; expected result is allowed owner operations succeed, cross-user and wrong-batch operations are denied, and temporary users/objects are cleaned up.
- [ ] **Step 10: Verify migration replay only on a fresh or disposable local database** and rerun pgTAP; inspect local project state first and ask before resetting any local database that could contain user data. Never use linked reset.

### Task 3: Server-only Supabase clients and typed read helpers

**Files:**
- Create: `lib/env.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/admin.ts`
- Create: `lib/database.types.ts` (generated from the local migrated database)
- Create: `lib/data/scheduler.ts`
- Modify: `.env.example`

**Interfaces:**
- `createUserSupabaseClient(): Promise<SupabaseClient<Database>>` binds the Supabase client to the current request's cookies and authenticated user's RLS context.
- `createAdminSupabaseClient(): SupabaseClient<Database>` is server-only and uses `SUPABASE_SERVICE_ROLE_KEY`; it is not used by ordinary user read helpers.
- `getSchedulerOverview(): Promise<SchedulerOverview>` obtains the current user from the user-scoped client and returns `batches: EmailBatchRow[]` and `messages: ScheduledEmailRow[]` for that user through RLS.

- [ ] **Step 1: Validate server environment values lazily** in `lib/env.ts` with Zod: the user client requires `SUPABASE_URL` and `SUPABASE_ANON_KEY`; only constructing the admin client requires `SUPABASE_SERVICE_ROLE_KEY`. Reject missing/malformed values with safe messages that do not echo values.
- [ ] **Step 2: Implement `createUserSupabaseClient`** using `@supabase/ssr`, `cookies()` from `next/headers`, and generated `Database` types; handle cookie reads/writes within Next.js's allowed server contexts.
- [ ] **Step 3: Implement `createAdminSupabaseClient`** in a separate `server-only` module using the Supabase JS client with session persistence/refresh disabled; never export it from a barrel imported by client code.
- [ ] **Step 4: Add exported row and return types plus read-only scheduler helpers** in `lib/data/scheduler.ts`; use only the user-scoped client, call `auth.getUser()` for verified identity, and rely on RLS rather than accepting caller-supplied owner IDs. `SchedulerOverview` has exactly `batches: EmailBatchRow[]` and `messages: ScheduledEmailRow[]`. Add no admin CRUD helper.
- [ ] **Step 5: Add placeholder-only server variable names to `.env.example`** without real URLs, keys, or tokens; do not add Supabase credentials to `NEXT_PUBLIC_*`.
- [ ] **Step 6: Generate `lib/database.types.ts`** from the local schema using `supabase gen types --lang typescript --local`; expected result is table/relationship typing aligned with the migrations.
- [ ] **Step 7: Verify the privileged boundary** by running typecheck/build with a non-production sentinel supplied as `SUPABASE_SERVICE_ROLE_KEY` and inspecting `.next/static`; expected result is the sentinel absent from client static assets and the `server-only` module not importable from client components.

### Task 4: Scripts, migration documentation, and full verification

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `.env.example` if needed from Task 3

**Interfaces:**
- Add npm scripts: `db:test` → `supabase test db`; `storage:test` → `node --test scripts/storage-policy.test.mjs`; `db:types` → `supabase gen types --lang typescript --local` redirected to `lib/database.types.ts`.
- README describes local migration, test, and type-generation commands and required local Supabase CLI/Docker setup.

- [ ] **Step 1: Add database test, Storage API test, and type-generation scripts** to `package.json` without changing npm dependency versions or adding a queue/database product.
- [ ] **Step 2: Document local prerequisites and commands** in README, including starting the local Supabase stack, resetting only the local DB, running pgTAP, regenerating types, applying reviewed migrations, the 10 MiB private PDF bucket, and future token encryption boundary.
- [ ] **Step 3: Document remote migration policy**: never use linked reset; review migrations and apply them only to the intended development/staging/production project through the documented migration process. No remote project linking or migration push in Phase 2.
- [ ] **Step 4: Run `npm run lint`**; expected result is no lint errors.
- [ ] **Step 5: Run `npm run typecheck`**; expected result is no TypeScript errors.
- [ ] **Step 6: Run `npm run build`** with local placeholder configuration only; expected result is a successful Next.js production build and no service-role sentinel in `.next/static`.
- [ ] **Step 7: Run `npm run db:test` and `npm run storage:test`**; expected result is passing table pgTAP and local Storage API isolation suites. If Supabase CLI, Docker, or the local Supabase HTTP services are unavailable, report the blocker and do not claim database tests passed.
- [ ] **Step 8: Review the final diff** for accidental secrets, client imports of the admin client, missing ownership policies, and out-of-scope OAuth/sending/worker code; report changed files, exact results, and any remaining environment requirement.

