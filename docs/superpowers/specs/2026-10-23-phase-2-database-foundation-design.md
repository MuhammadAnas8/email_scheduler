# Phase 2: Multi-user database foundation

## Goal and boundary

Establish a version-controlled Supabase database foundation for a multi-user email scheduler. Every application user's data is scoped to that user's stable `auth.users.id`. The database and private Storage enforce tenant ownership independently of the UI.

This phase adds schema, constraints, indexes, status transition guards, RLS, Storage ownership policies, server-only Supabase clients, typed read access, and cross-user database tests. It does not add Gmail OAuth, refresh-token storage or decryption, email sending, import/upload flows, queue execution, or the persistent worker.

## Current repository context

The repository uses Next.js App Router, TypeScript, React, Tailwind, npm, and already includes `@supabase/ssr` and `@supabase/supabase-js`. Phase 1 has the dashboard shell, status types, Zod schemas, and architecture documentation. There is no Supabase CLI configuration, SQL migration, server data client, or test script yet. Do not inspect or print `.env.local` values.

## Ownership and relational model

Use `auth.users.id` as the owner identifier; a separate profile table is unnecessary for this phase. Each user-owned table has a non-null `owner_id` referencing `auth.users(id) ON DELETE CASCADE`.

- `email_batches` stores owner, name, status, UTC start time, interval, timestamps, optional connected account, and optional CV object path.
- `scheduled_emails` stores owner, batch, recipient, subject, plain-text body, status, scheduling and retry timestamps, lease fields, attempt count, provider message ID, sanitized last error, and sent time.
- `email_attempts` stores owner, message, attempt number, start/end times, outcome, sanitized error, and optional provider message ID.
- `connected_accounts` stores owner, provider, stable provider subject, display email, connection metadata/status, and timestamps. Enforce one account per application user and prevent a single provider identity being bound to multiple application users. Do not store refresh tokens in this table.

Add composite uniqueness on `(owner_id, id)` where needed and composite foreign keys for `(owner_id, batch_id)`, `(owner_id, scheduled_email_id)`, and `(owner_id, connected_account_id)`. This makes cross-owner references fail even in privileged database operations. Batch deletion cascades to its messages and attempts. Gmail disconnection is a metadata state change; preserve the account row for historical references.

Use `timestamptz` for all stored times. Keep batch counters derived from message rows initially to avoid denormalized counts drifting from transactional message state. Create unique `(owner_id, scheduled_email_id, attempt_number)` for attempt history.

### Constraints and indexes

Use checks for the existing batch and message status sets, non-empty names/subjects/bodies, interval range 5–10 seconds, positive attempt numbers, and end time not preceding start time. Add constraints that bind optional attachment paths to the owning batch, using a generated key shape `{owner_id}/{batch_id}/cv.pdf`.

Create owner-scoped history indexes, message-by-batch ordering indexes, connected-account uniqueness indexes, and a partial queue index over due `pending`/`retrying` rows. The queue index supports a future worker but does not implement queue claiming in this phase.

Guard batch and message status updates in PostgreSQL with transition triggers. Batch transitions are `draft → scheduled|cancelled`, `scheduled → running|paused|cancelled|failed`, `running → paused|completed|cancelled|failed`, and `paused → running|cancelled|failed`. Message transitions are `pending → sending|skipped`, `retrying → sending|skipped|failed`, `sending → sent|retrying|failed|uncertain`, and `uncertain → sent|failed` for later manual resolution. `sent` and `skipped` are terminal. A later queue/control phase may add an explicit failed-message retry path through a guarded operation. Triggers also prevent changing `owner_id` after insert.

## RLS and access rules

Enable RLS on all four public tables. Policies target `authenticated` and require `owner_id = auth.uid()`; write policies also enforce that condition in `WITH CHECK`.

- Users may select their own batches, scheduled messages, attempts, and connected-account metadata.
- Users may insert only their own `draft` batches and update only their own draft batches in this phase. They may delete their own batches; child rows cascade. Status guards and RLS prevent a draft edit from directly advancing a batch into sending states.
- Do not grant authenticated users direct insert/update/delete access to scheduled messages, attempts, or connected-account metadata. Future batch creation and queue transitions will use narrowly scoped server/database operations added in their own phases.
- No policy grants cross-owner access. Missing write policies are intentional deny-by-default behavior.

Create a private CV bucket in migration SQL with a `{owner_id}/{batch_id}/cv.pdf` path. Storage object policies check both that the first path component equals `auth.uid()` and that the referenced batch belongs to that user. Permit only the owner operations needed for a future upload and signed download flow. Set the initial bucket limit to 10 MiB and restrict it to `application/pdf`; the upload phase will enforce the same limit server-side. Database deletion does not delete Storage objects; a later deletion flow must perform and recover both operations.

Test database RLS with two distinct authenticated JWT subject claims. pgTAP tests must verify own-row reads work, cross-owner reads return no data, foreign-owner inserts/updates and cross-owner references fail, and constraints and invalid status transitions are rejected. Test Storage isolation through the local Supabase Storage API with two temporary authenticated users; verify list/read/write/delete behavior follows the owner and owned-batch boundary. Do not mutate `storage.objects` directly in SQL tests.

## Server clients and credentials

Create server-only modules for a cookie-aware user-scoped client and a privileged admin client. The user client uses `@supabase/ssr`, the request session cookies, the Supabase URL, and the anon/publishable key so queries execute under the authenticated user's identity and RLS. Do not create a browser Supabase client in this phase.

Mark both modules with Next.js `server-only` protection. Validate required environment variables server-side. Keep the service-role key in a distinct environment variable that is never `NEXT_PUBLIC_*`, never imported by client components, and never logged. Treat the admin client as RLS-bypassing: do not use it for routine user queries, and require explicit server-side owner checks for privileged operations. Authentication UI and session establishment are outside this phase; the user client prepares for authenticated server routes in a later phase.

## Future refresh-token design

Do not add or store plaintext refresh tokens in Phase 2. In the Gmail phase, add a separate private schema/table for encrypted token material, with no grants to `anon` or `authenticated` and no user-facing RLS policy. Store ciphertext, nonce, authentication tag, and key version only. Encrypt/decrypt in trusted server or worker code using an externally managed key or secret; plan key rotation and recovery. The worker must resolve the account belonging to the message's owner. Database storage encryption alone does not replace application-level token encryption.

## Migration and types strategy

Commit ordered SQL migrations under `supabase/migrations/` and keep Supabase local configuration in the repository. Migrations create the core schema and constraints, then policies/grants and the private bucket/policies. Applying migrations to a local or hosted project must not require undocumented dashboard edits. Document reset/apply/test/type-generation commands and local Supabase CLI/Docker prerequisites.

Generate TypeScript database types from the migrated schema and use them in server-only typed data-access helpers. Keep user-facing reads on the cookie-aware RLS client. Do not add general-purpose admin CRUD helpers.

Use pgTAP tests under `supabase/tests/` and run them against the local Supabase database. Include two-user table RLS isolation, cross-owner FK failures, invalid status transitions, immutable ownership, and check/unique constraints. Use a separate local Storage API integration test for two-user attachment isolation. Never use production credentials or test table RLS as only the database owner/service role.

## Security risks and mitigations

- **RLS policy drift:** test all four tables and Storage with separate authenticated users; make ownership conditions explicit on every policy.
- **Service-role bypass:** isolate the admin client, avoid routine use, and require explicit authorization on privileged application operations.
- **Cross-tenant relationships:** duplicate `owner_id` where needed and use composite foreign keys, not only application-side checks.
- **Storage object orphans:** database cascades cannot remove Storage data; later deletion must be retryable and clean both resources.
- **Credential exposure:** no token storage yet; future token material is encrypted and private, with keys outside PostgreSQL and browser bundles.
- **Direct status manipulation:** deny client writes to queue tables and enforce database transition guards; later RPCs must be narrowly scoped and transaction-safe.
- **Worker trust boundary:** the future service-role worker bypasses RLS, so atomic claim and owner-to-account binding need separate Phase 6 tests.
- **Test environment availability:** pgTAP execution depends on local Supabase CLI and Docker; report environment blockers instead of claiming tests passed.

## Acceptance criteria

1. Four owner-scoped tables exist with the specified composite foreign keys, constraints, and indexes.
2. Status transition and owner immutability guards reject invalid changes.
3. RLS policies prevent cross-user access and deny premature direct queue/account writes.
4. CV Storage is private and policies check both authenticated owner and owned batch path.
5. Server-only user and admin clients are separated; privileged credentials are not exposed to client bundles.
6. Generated database types and typed server read helpers are present.
7. pgTAP tests cover cross-user table isolation, constraints, and transition rules; local Storage API tests cover attachment isolation.
8. Migration and local test instructions are documented; lint, typecheck, build, and available database tests are reported accurately.
9. No Gmail OAuth, plaintext or encrypted refresh-token storage, actual email sending, import flow, or worker is implemented.
