Codex Task Plan — Email Scheduler
Use AGENTS.md as the source of truth. Implement one phase at a time and review changes before proceeding.
First prompt to Codex
Read AGENTS.md fully. Inspect the current repository and package scripts before changing anything. Implement Phase 1 only:
- Create a responsive, accessible dashboard shell for the email scheduler.
- Add navigation for Overview, New Batch, History, and Settings.
- Add shared TypeScript domain types and Zod schemas for batch/message statuses and import records.
- Add .env.example with placeholders only and verify secrets are ignored by Git.
- Update README with setup commands, architecture, and the planned web-app/worker split.
- Keep all buttons honest: no fake sending, OAuth, or queue controls.
- Do not implement Gmail OAuth, database migrations, bulk sending, or the worker in this phase.
- Run the available lint/type-check/test/build commands and report exact results and changed files.
- Do not overwrite existing user work or perform destructive operations.
After Phase 1, stop and wait for review.
Subsequent prompts
Phase 2: Implement Supabase schema/migrations, constraints, indexes, RLS, and server-only clients. Include migration instructions and tests where feasible. Stop for review.

Phase 3: Implement CSV/JSON import, server-side validation, row-level errors, editable preview, 200-record cap, and private PDF upload. Do not send email. Stop for review.

Phase 4: Implement persistent batch/message records and transaction-safe pause/resume/cancel/skip behavior, with tests. Do not connect Gmail. Stop for review.

Phase 5: Implement secure Gmail OAuth and a manual single-email test with PDF attachment. Never expose secrets. Stop for review.

Phase 6: Implement the separate persistent worker, atomic message claims, 5–10 second spacing, leases, bounded retries, uncertain-send handling, and worker recovery tests. Stop for review.

Phase 7: Prepare separate web and worker deployment instructions, configure production readiness checks, and perform a small owner-controlled end-to-end test. Never claim deployment or tests succeeded unless verified.