# Phase 1 Multi-user-ready App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish a responsive and accessible scheduler shell with shared validation foundations and documentation for the planned multi-user web-app/worker architecture.

**Architecture:** Keep the Next.js App Router and existing TypeScript/React shell. Use shared dashboard navigation and honest placeholder destinations, shared TypeScript status definitions with Zod validation, and documentation that describes future ownership/security boundaries without implementing them.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Zod, npm.

**Spec:** `docs/superpowers/specs/2026-10-23-phase-1-multi-user-app-shell-design.md`

## Global Constraints

- Use Next.js App Router with TypeScript and React.
- Use Tailwind CSS for styling.
- Use the package manager indicated by the repository lockfile (npm).
- Do not implement Gmail OAuth, database migrations, bulk sending, or worker behavior in Phase 1.
- Keep service-role keys, OAuth client secrets, refresh tokens, and other secrets server-only; never put secrets in `NEXT_PUBLIC_*` variables, client components, browser logs, or Git.
- Scope future batches, messages, attachments, and Gmail connections to their stable owner user ID and enforce ownership server-side and with Supabase Row Level Security.
- Do not overwrite user changes or perform destructive operations.

## Review Focus

- A visitor must not mistake a placeholder destination for working email operations; verify all four nav destinations explain their current availability and no fake controls are present.
- Keyboard and assistive-technology users must be able to identify and use navigation; check landmarks, link names, current-page indication, and visible focus styles.
- Narrow viewports must retain access to navigation and main content; inspect mobile layout at a narrow viewport and confirm no horizontal overflow.
- Shared status schemas must stay aligned with TypeScript statuses; verify schema enum options derive from the status constants and existing batch input constraints remain intact.
- Local secrets must stay out of Git and command output; verify ignore rules and tracking status without reading `.env.local` contents.

---

### Task 1: Shared dashboard shell and honest destinations

**Files:**
- Create: `components/dashboard-shell.tsx`
- Create: `components/section-placeholder.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`
- Create: `app/new-batch/page.tsx`
- Create: `app/history/page.tsx`
- Create: `app/settings/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- `DashboardShell({ children }: { children: React.ReactNode })` provides the shared brand, primary nav (Overview, New Batch, History), Settings link, and page content frame.
- `SectionPlaceholder({ title, description }: { title: string; description: string })` renders a clearly marked not-yet-available section without operational controls.

- [ ] **Step 1: Extract shared navigation and page frame** into `components/dashboard-shell.tsx`; use semantic `<nav aria-label="Main navigation">`, links to `/`, `/new-batch`, `/history`, `/settings`, and `aria-current="page"` on the current route.
- [ ] **Step 2: Render the shell from the root layout** in `app/layout.tsx`, preserving metadata and global styles; remove duplicate sidebar/topbar markup from page content.
- [ ] **Step 3: Keep the Overview dashboard at `/`** in `app/page.tsx`; remove any navigation item that implies unimplemented queue actions and make all setup indicators explicitly informational.
- [ ] **Step 4: Add explicit placeholder destinations** at `/new-batch`, `/history`, and `/settings` using `SectionPlaceholder`; explain that import/scheduling, history persistence, and account settings respectively arrive in later phases, and include no fake action buttons.
- [ ] **Step 5: Refine responsive and focus styling** in `app/globals.css`; confirm nav and content remain usable at narrow widths, keyboard focus is visible, and reduced-motion preferences are respected for any transitions.
- [ ] **Step 6: Review placeholder and accessibility behavior** by inspecting each destination for correct title, link name, current-page marker, semantic landmarks, and lack of fake controls; inspect at a narrow viewport for overflow.

### Task 2: Align shared statuses and Zod schemas

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/schemas.ts`

**Interfaces:**
- Preserve `batchStatuses`, `BatchStatus`, `messageStatuses`, `MessageStatus`, and `EmailRecord` exports.
- Preserve `emailRecordSchema`, `emailBatchSchema`, `EmailRecordInput`, and `EmailBatchInput` exports.

- [ ] **Step 1: Add status Zod enums derived from the shared constants** (`z.enum(batchStatuses)` and `z.enum(messageStatuses)`) and export them from `lib/schemas.ts`.
- [ ] **Step 2: Preserve and inspect the existing validation constraints:** valid email recipient; trimmed non-empty subject and body; batch name 1–120 characters; integer interval 5–10 seconds; nullable offset-aware ISO start time; and 1–200 messages.
- [ ] **Step 3: Document the future ownership requirement in domain comments** only where useful: persisted batches, messages, attachments, and connected accounts will be scoped to a stable Supabase Auth user ID; do not add synthetic IDs or database-specific code.
- [ ] **Step 4: Verify the status enum values match the exported status constants** by checking each enum is directly constructed from its corresponding constant and reviewing TypeScript inference at its exports.

### Task 3: Document architecture, configuration, and launch prerequisites

**Files:**
- Modify: `README.md`
- Modify: `.env.example` only if its placeholders or comments need correction
- Modify: `.gitignore` only if required ignore coverage is missing

**Interfaces:**
- No runtime API changes.
- README is the setup and architecture guide for the repository.

- [ ] **Step 1: Update README project description and layout** to describe the multi-user target, Supabase Auth stable user IDs, owner-scoped data, and the separate persistent Node.js/TypeScript worker.
- [ ] **Step 2: Document the trust boundaries and phase limits**: service-role key server/worker-only; RLS plus server-side authorization; per-user Gmail connection and encrypted refresh tokens in a later phase; no auth, import, persistence, OAuth, or sending currently enabled.
- [ ] **Step 3: Add a production/public-registration prerequisites section** covering auth configuration, ownership/RLS and Storage policies, secure OAuth/token storage, worker deployment/recovery, secret configuration, request limits, and an owner-controlled end-to-end verification before real outreach.
- [ ] **Step 4: Check configuration hygiene without reading secret contents:** verify `.env.example` contains only placeholder values; verify `.env.local` is ignored and not tracked; confirm credential/key/token/upload ignore rules cover the project paths.

### Task 4: Run available project checks and report results

**Files:**
- No additional files expected.

**Interfaces:**
- Uses the scripts already defined in `package.json`: `lint`, `typecheck`, and `build`.

- [ ] **Step 1: Run `npm run lint`** and resolve any lint errors caused by Phase 1 changes.
- [ ] **Step 2: Run `npm run typecheck`** and resolve any TypeScript errors caused by Phase 1 changes.
- [ ] **Step 3: Run `npm run build`** and record its exact result.
- [ ] **Step 4: Review the final diff and report** changed files, command outcomes, the absent test script, and remaining security work that belongs to later phases; do not claim checks passed unless their commands succeeded.

