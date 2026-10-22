# Phase 4 Queue and Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each user's confirmed email batch and its ordered messages in Supabase, with safe schedule, pause, resume, cancel, and skip operations that never claim to send mail.

**Architecture:** Keep Phase 3's authenticated Supabase client and draft creation flow. Add narrowly scoped authenticated PostgreSQL RPCs that lock the batch row, validate legal transitions, and atomically update all affected records. Compute counts from message rows on read instead of storing denormalized counters. Add owner-scoped history and real control UI; explicitly state that queued messages are not delivered until a later worker phase.

**Tech Stack:** Next.js App Router, TypeScript, React, Supabase PostgreSQL/RPC/RLS, Supabase SSR client, Zod, Node's built-in test runner, pgTAP.

**Spec:** Phase 4 requirements in `CODEX_TASK_PLAN.md`, this request, and the queue/control requirements in `AGENTS.md`.

## Global Constraints

- One user's batches and messages must remain inaccessible to every other user through server checks and RLS.
- Store timestamps as `timestamptz` in UTC; convert the browser's local `datetime-local` value to ISO UTC before submission.
- Enforce the interval range of 5 through 10 seconds in client validation, server Zod validation, and PostgreSQL constraints/RPC validation.
- A batch may contain 1 through 200 valid messages.
- Do not implement Gmail OAuth, provider calls, sending, worker behavior, retries, or pretend delivery progress.
- Never mark a message `sent` or a batch `completed` in Phase 4.
- Preserve CSV/JSON import, editable preview, draft persistence, and private CV upload.
- Use the existing npm lockfile and dependencies; do not add a queue service or database.
- Keep message history until the owner explicitly deletes its batch; Phase 4 will not add automatic cleanup.

## Review Focus

- Two simultaneous lifecycle actions can race; test that row locking yields one valid resulting state and no partial message updates.
- Repeated schedule/control requests can arrive after a timeout; test idempotent repeats and ensure they never duplicate messages or counts.
- A user can submit another user's UUID; test every RPC and read path returns no cross-owner data or mutation.
- A future timestamp can be stale, malformed, or offset incorrectly; test server rejection of stale values and stable UTC ordering.
- Skipping or cancelling the last pending message can leave confusing state/counts; test zero-pending outcomes and honest UI copy without implying delivery.

---

## Design Decisions

### Lifecycle writes

Use `SECURITY DEFINER` RPCs with `search_path` pinned to trusted schemas, `auth.uid()` as the sole owner identity, and `SELECT ... FOR UPDATE` on the target batch. Revoke direct authenticated writes to lifecycle fields and message rows; authenticated users continue to read their own data under existing RLS. The functions return the resulting batch state and reject illegal transitions with stable SQLSTATEs (`42501` unauthenticated, `P0002` missing or foreign record, `22023` malformed input, `55000` illegal transition). A request repeated after the desired transition succeeds without a second mutation; schedule retries return the already-persisted schedule unchanged rather than applying a changed payload. Competing different actions serialize on the batch lock and the later action is validated against the committed state. Every function that changes a message first locks its batch and then locks/updates message rows, using the same lock order.

Allowed transitions in this phase:

- `draft -> scheduled` when the owner confirms a valid batch.
- `scheduled -> paused` and `paused -> scheduled`.
- `scheduled -> cancelled` and `paused -> cancelled`.
- `pending -> skipped` for one message in a scheduled or paused batch.
- `pending -> cancelled` for every still-queued message when its batch is cancelled.
- Repeated requests for the current target state are no-ops. Other transitions, including direct changes to `running`, `completed`, `sent`, or `sending`, are rejected.

Phase 4 does not transition a scheduled batch to `running`: no worker exists to claim or send messages. A cancellation sets only still-pending messages to `cancelled`; already skipped history remains `skipped`.

### Schedule and ordering

The draft RPC will persist a stable 1-based `position` from import order. A new `schedule_email_batch(p_batch_id, p_starts_at, p_interval_seconds)` RPC validates a draft with 1–200 pending messages, sets the batch to `scheduled`, and assigns each message `scheduled_at = effective_start + (position - 1) * interval`. A null start means start immediately at the database statement timestamp. A non-null start must be in the future at confirmation time. `next_attempt_at` is set equal to `scheduled_at` for future worker compatibility, but Phase 4 will not read it as a send claim. The database remains authoritative for schedule time and interval.

### Accurate counts

Do not add mutable counters or update-count triggers. Provide an authenticated, `SECURITY INVOKER` count RPC that groups each owner's message rows by batch and status. The history/overview UI uses these derived totals. Counts therefore reflect the committed row state, cannot double-increment on retries, and cannot drift during concurrent skip/cancel operations.

### User interaction and honesty

The new-batch flow keeps draft save and PDF upload intact, then presents an explicit confirmation with “Start immediately” or a local date/time and a 5–10 second interval. Scheduling submits only after a draft exists and any selected PDF upload has succeeded. History lists stored batches and messages with persisted statuses/counts and controls appropriate to the current status. A visible notice states that scheduling/control state is saved, but messages will not send until a later phase adds the worker and Gmail integration. No send button or delivery claim is added.

### Approaches considered

1. **Direct table updates from the web client:** rejected because multi-row scheduling/cancellation and transition validation would be spread across requests and susceptible to partial writes.
2. **RPCs plus stored counters maintained by triggers:** safe when designed carefully, but adds a second mutable source of truth and makes concurrent updates and retries harder to audit.
3. **Authenticated row-locked RPCs plus derived counts (recommended):** keeps each state change atomic in PostgreSQL, retains RLS for reads, and computes counts from the authoritative messages table without counter repair logic.

---

## Files to Change

- Create `supabase/migrations/20261023000400_phase4_queue_controls.sql`: ordered message position, cancelled status, safe scheduling/control/count RPCs, grants, and removal of direct authenticated lifecycle writes.
- Modify `lib/database.types.ts`: add the `position` field and generated RPC signatures/status types.
- Modify `lib/types.ts` and `lib/schemas.ts`: add confirmed schedule/control/count input and output types and action schemas.
- Modify `app/api/batches/route.ts`: preserve draft creation and its current validation; no change to its owner source.
- Create `app/api/batches/[batchId]/schedule/route.ts`: authenticated, Zod-validated schedule confirmation.
- Create `app/api/batches/[batchId]/actions/route.ts`: authenticated pause/resume/cancel endpoint with action validation.
- Create `app/api/batches/[batchId]/messages/[messageId]/skip/route.ts`: authenticated skip endpoint scoped by both IDs.
- Create `app/api/batches/[batchId]/route.ts`: owner-scoped batch detail read for history/control UI.
- Modify `lib/data/scheduler.ts`: keep server-only reads, return batch/message details and derived counts through the invoker RPC.
- Modify `components/new-batch-workflow.tsx`: add schedule selection/interval and explicit confirmation after draft and optional PDF persistence.
- Modify `app/history/page.tsx` and `components/dashboard-shell.tsx`: replace the placeholder with persisted history, state-aware controls, and no-send-yet disclosure.
- Modify `app/page.tsx`: show real owner-scoped queue counts with clear “not sending yet” copy.
- Create `supabase/tests/database/phase4_queue_controls.test.sql`: pgTAP transition, schedule, count, constraint, and ownership coverage.
- Create `tests/phase4-queue.integration.test.mts`: local-Supabase authenticated concurrent/repeated operation tests; use only explicit local test credentials and skip with a clear reason if local Supabase test configuration is absent.
- Modify `package.json`: add a Phase 4 integration test script while preserving existing Phase 3 and database test commands.
- Modify `README.md`: explain migration application, queue-only Phase 4 behavior, and required local test configuration.

## Interfaces

- `schedule_email_batch(p_batch_id uuid, p_starts_at timestamptz, p_interval_seconds smallint) -> uuid`: returns the batch ID after atomically scheduling its pending rows.
- `pause_email_batch(p_batch_id uuid) -> text`, `resume_email_batch(p_batch_id uuid) -> text`, and `cancel_email_batch(p_batch_id uuid) -> text`: return the resulting batch status.
- `skip_scheduled_email(p_batch_id uuid, p_message_id uuid) -> text`: returns the resulting message status.
- `get_email_batch_counts() -> table(batch_id uuid, total_count bigint, pending_count bigint, skipped_count bigint, cancelled_count bigint, sent_count bigint, failed_count bigint, uncertain_count bigint)`: returns counts only for rows visible to the calling owner; future statuses remain countable without exposing other owners.
- Route input uses an action enum of `pause | resume | cancel`. Schedule input uses `startsAt: string | null` and `intervalSeconds: integer`; null means immediate, non-null is an ISO datetime with explicit offset.
- `getSchedulerOverview()` remains server-only and returns only authenticated owner's batch/message data plus count rows. No service-role client is used for normal queue operations.

---

## Implementation Tasks

### Task 1: Lock down schema and lifecycle invariants

**Files:**
- Create: `supabase/migrations/20261023000400_phase4_queue_controls.sql`
- Modify: `lib/database.types.ts`
- Modify: `lib/types.ts`
- Test: `supabase/tests/database/phase4_queue_controls.test.sql`

**Interfaces:**
- Consumes Phase 2/3 tables, RLS, and `create_draft_email_batch(text, jsonb)`.
- Produces the schema/RPC contracts listed under Interfaces above.

- [ ] **Step 1: Write pgTAP tests for schedule and status contracts**

Assert draft scheduling, immediate start timestamp, future start timestamp, position-based interval spacing, 5/10 second bounds, rejection of 4/11 seconds and past timestamps, no transition to `running`/`sent`, pause/resume/cancel legality, one-message skip, cancellation of remaining pending rows, repeated target-state calls, and exact derived status counts.

- [ ] **Step 2: Add pgTAP owner isolation assertions for every new RPC**

As owner A, call schedule/pause/resume/cancel/skip/count with owner B IDs. Assert each mutation fails as not found/unauthorized without changing B's batch or messages, and counts contain no B batch IDs.

- [ ] **Step 3: Run the database tests and confirm they fail for missing Phase 4 behavior**

Run: `npm run db:test`
Expected: the new test file fails because Phase 4 columns/functions/status behavior do not exist yet. If local Supabase is unavailable, report the environment failure and continue with tests written first.

- [ ] **Step 4: Implement the migration**

Add a non-null 1-based `position` for existing rows using deterministic `created_at, id` order per batch, add a unique `(owner_id, batch_id, position)` constraint, and update the draft RPC to preserve JSON ordinality. Extend message status constraint with `cancelled`. Add pinned-search-path owner-authenticated RPCs. Each transition RPC locks the batch row before checking state; cancellation updates the batch and all pending messages in one transaction. Scheduling computes timestamps using database time and position. The count RPC derives counts from `scheduled_emails` and is `SECURITY INVOKER`. Revoke direct authenticated insert/update/delete on queue messages and direct batch updates; keep owner-scoped reads and explicit owner batch deletion grants/policy as currently defined.

- [ ] **Step 5: Update generated/shared TypeScript contracts**

Represent `position` and new RPCs in `lib/database.types.ts`; add `cancelled` to `messageStatuses` and the relevant input/output types in `lib/types.ts`.

- [ ] **Step 6: Run database tests and review migration safety**

Run: `npm run db:test`
Expected: Phase 2/3 isolation tests and Phase 4 lifecycle tests pass against local Supabase. Confirm the migration is additive and does not rewrite/remove existing user records.

### Task 2: Add validated owner-scoped queue APIs

**Files:**
- Modify: `lib/schemas.ts`
- Modify: `app/api/batches/route.ts` only if shared validation needs extraction; preserve existing draft behavior.
- Create: `app/api/batches/[batchId]/schedule/route.ts`
- Create: `app/api/batches/[batchId]/actions/route.ts`
- Create: `app/api/batches/[batchId]/messages/[messageId]/skip/route.ts`
- Create: `app/api/batches/[batchId]/route.ts`
- Modify: `lib/data/scheduler.ts`
- Test: `tests/phase4-queue.integration.test.mts`

**Interfaces:**
- Consumes the authenticated RPCs from Task 1 and `createUserSupabaseClient()` / `getAuthenticatedUser()`.
- Produces REST endpoints for schedule, pause, resume, cancel, skip, and owner-scoped batch details.

- [ ] **Step 1: Add request schema tests**

Test malformed UUIDs, unsupported actions, missing fields, non-integer intervals, intervals below 5 or above 10, malformed timestamps, and future-versus-past schedule validation. Assert immediate scheduling is represented only by explicit `startsAt: null`.

- [ ] **Step 2: Implement schedule API and verify its contract**

Require an authenticated user, parse bounded JSON with Zod, call `schedule_email_batch`, map SQLSTATE validation errors to 400, unauthenticated to 401, and missing/foreign batch to the same 404 response. Return the resulting batch ID/status; never return message body content.

- [ ] **Step 3: Implement batch action API**

Accept only pause/resume/cancel and call the corresponding RPC. Preserve idempotent RPC results. Map invalid transitions to 409 and unauthenticated requests to 401 without exposing SQL details.

- [ ] **Step 4: Implement message skip API**

Validate both UUIDs, require authentication, call `skip_scheduled_email` with both IDs, and map foreign/missing rows to 404 and invalid state to 409.

- [ ] **Step 5: Implement owner-scoped batch detail and overview reads**

Use the user-scoped Supabase client only. Query under RLS, obtain count rows through the invoker count RPC, and return predictable UI-safe status/count data. Never instantiate the service-role client for these routes.

- [ ] **Step 6: Add local-Supabase integration fixtures and authorization tests**

Create disposable users using an explicitly configured local-only test service key; sign in as each user with separate anon clients; create draft data through authenticated RPCs; then verify A cannot read or mutate B's batch or skip B's message. Ensure fixtures clean up in `finally` and reject non-loopback Supabase URLs. Do not read `.env.local` implicitly and do not use production credentials.

### Task 3: Connect draft preview to real scheduling and controls

**Files:**
- Modify: `components/new-batch-workflow.tsx`
- Modify: `app/history/page.tsx`
- Modify: `components/dashboard-shell.tsx`
- Modify: `app/page.tsx`
- Modify: `lib/data/scheduler.ts`

**Interfaces:**
- Consumes the Phase 4 API routes and server-only scheduler read model from Task 2.
- Produces UI state only from persisted batch/message records and count RPC results.

- [ ] **Step 1: Add schedule UI behavior tests or extract/test small schedule helpers**

Test conversion from a local `datetime-local` value to an ISO UTC timestamp, explicit immediate mode to `null`, boundary interval values 5/10 accepted and 4/11 rejected, and inability to confirm while rows are invalid, no draft exists, or a selected attachment upload failed.

- [ ] **Step 2: Add schedule choices to the current new-batch workflow**

Retain import, edit/remove, draft creation, and PDF upload. Add immediate/future choice plus interval selector. First save/finish the draft and attachment; then explicitly confirm scheduling. On success refresh persisted state and show “Scheduled; sending is not available until the worker phase.” On API failure keep the draft and values so retry does not create duplicate messages.

- [ ] **Step 3: Replace the History placeholder with persisted batches and messages**

Render batch status, creation/start time, interval, owner-derived counts, and per-message recipient/status/scheduled time. Show bodies only on the owner's own page and avoid logging them. Provide pause/resume/cancel/skip only for legal current states; after requests, refresh from Supabase rather than predicting final state locally. Keep explicit confirmation before cancellation and explain that cancellation stops future queue work; Phase 4 sends nothing.

- [ ] **Step 4: Replace placeholder overview counts with persisted queue totals**

Render counts from the server read model and clarify that pending is queued state, not sent or actively delivered. Add empty/loading/error states with existing visual styles and accessible control labels.

- [ ] **Step 5: Manually verify import and PDF behavior remains intact**

Exercise CSV and JSON preview, edits/removal, draft save, PDF upload, scheduling after successful upload, then pause/resume/cancel/skip from history. Confirm refresh preserves every status and never displays a sent/completed state.

### Task 4: Verify concurrency, regression, and release boundary

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Test: `tests/phase4-queue.integration.test.mts`
- Test: all existing Phase 3 and Storage tests.

**Interfaces:**
- Consumes all Task 1–3 behavior.
- Produces documented local test commands and Phase 4 completion evidence.

- [ ] **Step 1: Test duplicate requests**

Send each valid transition twice and assert the resulting status and row counts are unchanged after the second request; confirm schedule retry does not duplicate messages.

- [ ] **Step 2: Test concurrent operations against local Supabase**

Issue competing pause/cancel and skip/cancel requests concurrently from authenticated local test clients. Assert one legal serialized result, no mixed batch/message state, no duplicated rows, and counts equal a fresh aggregation of message statuses. Permit either legal winner where requests are truly concurrent, but never permit an invalid transition or partial cancellation.

- [ ] **Step 3: Test scheduling and persistence across fresh reads**

Test immediate and future starts; reload batch/message queries through a new server client and assert identical UTC timestamps, positions, intervals, and statuses.

- [ ] **Step 4: Run all available checks**

Run: `npm run test:phase3`
Run: `npm run test:phase4` (new script)
Run: `npm run db:test`
Run: `npm run storage:test`
Run: `npm run lint`
Run: `npm run typecheck`
Run: `npm run build`

Expected: each available command exits 0. If local Supabase is unavailable, report database/integration tests as not run with the exact cause; do not treat skipped tests as passing.

- [ ] **Step 5: Inspect final diff and document behavior**

Review all changed files for unexpected user edits, direct table writes, service-role use in user routes, untrusted owner IDs, logging of email bodies, fake sending controls, and false `sent`/`completed` transitions. Update README with exact migration/test commands, local-only test env names, and the Phase 4 no-worker limitation.

## Completion Criteria

- Drafts become scheduled only through an authenticated explicit confirmation.
- Immediate and future scheduling persist UTC starts and deterministic per-message spacing using an interval of 5–10 seconds.
- Pause/resume/cancel/skip persist through PostgreSQL transactions and remain correct under retries/concurrent requests.
- Owner A cannot read or mutate owner B's batch/messages/counts.
- Counts always equal the current persisted message rows and do not use separately incremented counters.
- Existing import preview and private PDF upload continue to work.
- The UI displays honest persisted statuses and says that Phase 4 does not send email.
- No Gmail OAuth, email provider operation, or worker code is added.
