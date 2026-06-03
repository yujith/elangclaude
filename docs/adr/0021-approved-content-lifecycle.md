# ADR-0021: SuperAdmin lifecycle management for approved content

> Status: Accepted · 2026-06-03

## Context

`/content` (and the four `/content/{section}` pages) only ever surfaced
`PendingReview` tests. Once a SuperAdmin approved a test it dropped out of
view — a short "recent 10" list on the Listening page was the only window,
and the section review page went read-only ("already Approved — no action
needed"). There was no supported way to pull a live test back out of the
learner pool, send it back for editing, or remove an unused one.

We needed: **see all approved content across every section, and manage its
lifecycle** (retire / reopen / delete).

`Test` is a global (non-tenant) model. Its status enum is
`Draft | PendingReview | Approved | Rejected`. The relevant relations:
`Attempt.test` is `onDelete: Cascade`, and `Attempt` in turn cascades to
`Answer`, `Grade`, and `Recording`.

## Decisions

### D1 — Retire reuses the `Rejected` status (no new enum value)

Retiring a live test sets `Approved → Rejected`. We deliberately did **not**
add a `Retired`/`Archived` status, to avoid a migration. The learner picker
already filters on `status: "Approved"`, so flipping to `Rejected` removes the
test immediately.

The cost: `Rejected` now conflates "failed initial review" with "was live,
then pulled". We mitigate by writing a **distinct ActivityLog action**,
`content.{section}.retired` (vs. `content.{section}.rejected`), so the audit
trail still tells the two apart. Reopen (`Approved → PendingReview`, action
`content.{section}.reopened`) restores it through the normal review +
contract-guard path.

If retire volume or reporting needs grow, promoting `Retired` to a real status
is a clean follow-up.

### D2 — Hard delete is guarded by a zero-attempt check in app code

Because `Attempt.test` cascades all the way to `Answer`/`Grade`/`Recording`,
deleting an attempted test would silently destroy learner history across every
org. Delete is therefore permitted **only when the test has zero `Attempt`
rows**; otherwise the action refuses and tells the SuperAdmin to retire
instead. The UI only renders the delete affordance when `attemptCount === 0`.

We kept the guard in application code rather than changing the FK to
`onDelete: Restrict`. The app guard ships without a migration and gives a
friendly message; the DB-level `Restrict` is a reasonable future hardening but
was out of scope here.

The attempt count **must** be taken cross-org via `withSuperAdminContext()` —
a global `Test` can carry attempts from any org, so scoping the count to the
SuperAdmin's own org could green-light a delete that wipes another org's data.
This is asserted in `packages/db/src/content-lifecycle.test.ts`.

### D3 — Lifecycle policy is a pure module in `@elc/db`

The retire/reopen/delete *decisions* (`planRetire`, `planReopen`, `planDelete`)
live in `packages/db/src/content-lifecycle.ts` — pure functions with no Prisma,
Clerk, or Next imports. The SuperAdmin server actions in
`apps/web/lib/content/lifecycle-actions.ts` own the I/O (load row, count
attempts, write row + ActivityLog under `SYSTEM_ORG_ID`, redirect) and call the
policy. This keeps the policy unit-testable in the existing `packages/db`
Vitest harness, since the server actions themselves depend on the Next/Clerk
runtime and aren't unit-testable in this repo.

## Consequences

- `/content` gains a Pending / Approved view toggle; each `/content/{section}`
  page lists approved content with a "Manage" drill-down.
- The section review page renders a lifecycle action bar (Reopen / Retire /
  Delete) when a test is `Approved`. Retire and Delete are confirm-gated.
- No schema migration. New ActivityLog actions: `content.{section}.retired`,
  `content.{section}.reopened`, `content.{section}.deleted` (all under
  `SYSTEM_ORG_ID`).
- Tenant isolation: every query uses `withSuperAdminContext()` (Test/Question
  are global); the one tenant-scoped read — the attempt-count guard — is
  intentionally cross-org. See `.claude/rules/multi-tenancy.md`.
