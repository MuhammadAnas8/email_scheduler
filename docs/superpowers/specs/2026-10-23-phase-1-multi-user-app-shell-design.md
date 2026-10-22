# Phase 1: Multi-user-ready email scheduler shell

## Context and goal

The repository contains a Next.js app shell, shared batch/message status types, and Zod schemas. This phase will refine those foundations for a future multi-user email scheduler while keeping the product inert: no login, database access, Gmail connection, import workflow, or email sending is implemented here.

The application is designed for multiple independent users even if its first deployment is private. Future records and Gmail connections must belong to a stable Supabase Auth user ID, and future server/database boundaries must enforce that ownership. Phase 1 communicates and prepares for those boundaries without pretending to enforce them.

## Security review findings

- All future user-owned records (batches, messages, attempts, attachments, and Gmail connections) need an owner identifier tied to Supabase Auth. Row Level Security and server-side authorization must enforce ownership; client-supplied owner IDs are not authorization.
- Foreign keys and scoped relationships should prevent records owned by one user from referencing another user's objects. Private Storage paths and policies need the same ownership boundary.
- A Supabase service-role key bypasses RLS. It must remain server/worker-only, be used narrowly, and not replace explicit authorization checks in privileged operations.
- Gmail OAuth requires state validation, secure callback/session handling, per-user account binding, encrypted refresh tokens, secure revocation, and no token exposure in browser code or logs.
- The persistent worker is a distinct trust boundary. It needs atomic claims, leases/recovery, and explicit owner-to-Gmail-account selection. It must not retry uncertain sends blindly.
- Email content, recipient addresses, attachments, and OAuth data are sensitive. Future phases need request limits, private storage and short-lived signed URLs, plain-text-safe rendering, sanitized provider errors, and data-minimizing logs.
- The current shell is not authenticated. It must not be treated as private or deployed with private user data until server-side access controls are implemented.

These items are future-phase requirements unless stated in the Phase 1 scope below.

## Phase 1 design

### App shell and navigation

Keep the existing Next.js App Router and Tailwind-based shell. Provide navigation for Overview, New Batch, History, and Settings with responsive layout, accessible names/current-page indication, and useful empty or setup states. Destinations that do not yet have functionality must say so clearly; controls must not imply that imports, authentication, queue controls, OAuth, or sending are operational.

### Shared domain foundations

Keep batch and message status definitions as shared TypeScript domain types. Keep Zod schemas for email records and batch inputs, with schema enums derived from the shared status definitions where applicable. Preserve constraints already required by the product, including valid recipient, non-empty subject/body, interval between 5 and 10 seconds, and a maximum of 200 messages. Document ownership as a future persistence requirement; do not invent local or global user identity or add database code.

### Configuration and documentation

Keep `.env.example` restricted to safe placeholders. Verify `.env.local`, credential/key/token patterns, and local upload paths remain ignored and that `.env.local` is not tracked, without printing its contents. Update README to explain the web-app/persistent-worker split, the planned per-user Supabase Auth and data ownership model, current non-functional areas, and the remaining work required before public registration or production use.

### Checks

Use the repository's existing npm scripts: lint, typecheck, and build. Do not add a test framework or test script in this phase unless implementation reveals a concrete need; no test script currently exists. Report the exact commands and results.

## Scope exclusions

- Supabase migrations, database clients, RLS policies, or storage configuration.
- Authentication, authorization middleware, or public registration controls.
- CSV/JSON parsing, attachment upload, batch persistence, or queue controls.
- Google OAuth, Gmail API calls, message sending, or worker behavior.
- Deployment or production credentials.

## Acceptance criteria

1. The dashboard exposes the four requested destinations and communicates unavailable functionality honestly.
2. The shell remains responsive and accessible, including navigation state and empty/setup messaging.
3. Shared status types and Zod schemas remain aligned and preserve product validation constraints.
4. `.env.example` contains placeholders only; `.env.local` is ignored and not tracked; no secret values are emitted during verification.
5. README explains the planned multi-user ownership boundaries, web/worker split, current phase limits, and launch prerequisites.
6. Existing lint, type-check, and build scripts are run and their results are reported accurately.
7. No Gmail, database, authentication, import, or worker behavior is added.
