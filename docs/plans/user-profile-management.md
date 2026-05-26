# Plan: User profile management (Track + Password)

> Status: agreed 2026-05-25. Decisions D1 (block on in-progress) and D2 (top-
> level `/profile`) are locked in below. ADR 0016 will capture the same record
> once the implementation lands.

## Goal

Give every authenticated user (Learner, OrgAdmin, SuperAdmin) a single
`/profile` surface where they can:

1. Change their IELTS track preference (`Academic` ↔ `GeneralTraining`).
2. Change their password via Clerk's `<UserProfile />` widget (with email and
   active-session management coming along for the ride from the same widget).

This is the first read-then-write self-service surface in the app. The scope is
intentionally narrow (track + password) so we wire the auth/data pattern
correctly once and add `name`, avatar, MFA, notification prefs as follow-ups
without re-litigating the shell.

## Scope

### IN

- New top-level `/profile` route, available to all three roles.
- "IELTS preference" section: server action that updates `User.ielts_track`
  through `withOrg(ctx)`. The action **blocks** when the caller has an
  in-progress `Attempt` or `MockSession` (D1).
- "Password & devices" section: Clerk `<UserProfile />` styled via the
  existing `clerkAppearance`, scoped to password change and active sessions.
- Entry point: the existing name/email block on each role header becomes a
  Link to `/profile`.
- `ActivityLog` row on track change (`profile.track_changed`) under the
  user's own `org_id`.
- Vitest unit tests (two-org fuzzer style) + one Playwright happy-path spec.

### OUT (deferred)

- Editing display `name` — Clerk syncs this on next sign-in via the lazy-link
  name-stamp path (ADR-0014 D2).
- Avatar upload — needs R2 pipeline.
- Notification preferences — no model yet.
- Curating Clerk's `<UserProfile />` tabs (account deletion, OAuth links,
  MFA opt-in) — shipping defaults; tighten in a follow-up if needed.
- SuperAdmin editing *another* user's profile — already covered by
  `/orgs/[id]/users`.

## Affected layers

- DB schema — **no migration**. `ielts_track` already exists; we only add a
  new `ActivityLog.action` value (free-form string).
- DB helper — `updateMyIeltsTrack(ctx, input)` in
  `packages/db/src/profile.ts`, exported from `@elc/db`.
- Server action — `apps/web/lib/profile/actions.ts` calls
  `requireOrgContext()` + the DB helper.
- UI — `apps/web/app/profile/[[...profile]]/page.tsx` (server),
  `apps/web/components/profile-track-form.tsx` (client),
  `apps/web/components/profile-password-section.tsx` (client wrapper around
  the curated Clerk security page).
- Header chrome — wrap the existing name/email block in `(learner)`,
  `(admin)`, `(super)` layouts in a Link to `/profile`.
- Tests — `packages/db/src/profile.test.ts` (fuzzer) +
  `apps/web/tests/e2e/profile.spec.ts` (one happy-path).
- Docs — ADR 0016 + a short mention in root `CLAUDE.md`.

## Decisions (locked)

### D1 — Block track switching while in-progress work exists

If the caller has any `Attempt` with `status = "InProgress"` or any
`MockSession` with `status = "InProgress"`, `updateMyIeltsTrack` returns
`{ ok: false, reason: "in_progress_work" }`. The form surfaces a clear
message: "Finish or abandon your in-progress {Academic|General Training}
work before switching tracks." Reasons:

- Section pickers and mock launcher filter by `user.ielts_track`. Switching
  silently strands in-progress rows under the opposite track filter.
- "Auto-abandon on switch" is destructive without explicit consent.
- "Warn-and-allow" creates orphan rows learners can only reach by toggling
  the track back — a worse UX than just finishing the session.

### D2 — `/profile` is a top-level route, not three role-scoped copies

`app/profile/[[...profile]]/page.tsx` sits outside `(learner)/`,
`(admin)/`, `(super)/`. The page renders its own minimal brand header
(logo + back link + sign-out) and picks the back-link target (`/home`,
`/admin`, `/orgs`) from `ctx.role`. The optional catch-all lets Clerk's
path-based subpages, such as `/profile/security`, reload in the same shell.

Trade-off accepted: the role-specific header (with its nav strip and
org name) is replaced on `/profile` with a simpler shell. The win is that
the form, the action wiring, and the appearance overrides live in one
place. If we ever need the role headers back, the rollback is one move per
role: `app/profile/[[...profile]]/page.tsx` →
`app/(role)/profile/page.tsx`.

### D3 — Clerk widget exposes only security

We render `<UserProfile routing="path" path="/profile" />` so the security
surface (password, sessions, MFA) is linkable and reload-safe under
`/profile/*`. The widget includes only `<UserProfile.Page label="security"
/>`, so the Account page (email addresses and connected accounts) is not
exposed. Profile-specific appearance overrides hide the delete-account row
and remove Clerk's sidebar/header so the section reads like the rest of the
application.

## Phases

### Phase 1 — DB helper + tests

- Add `packages/db/src/profile.ts`:
  - `export type UpdateTrackFailureReason = "invalid_track" | "in_progress_work"`
  - `export async function updateMyIeltsTrack(ctx, { ielts_track })` that:
    - Validates `ielts_track` against the `Track` enum.
    - Reads the caller's current track via `withOrg(ctx).user.findUnique`.
    - If unchanged → returns `{ ok: true, ielts_track, changed: false }`,
      no ActivityLog write.
    - Otherwise looks for any in-progress `Attempt` or `MockSession` via
      `withOrg(ctx)` and returns `in_progress_work` if found.
    - Updates `User.ielts_track` and writes `profile.track_changed`
      ActivityLog with `{ from, to }` metadata in one transaction.
- Export from `packages/db/src/index.ts`.
- Add `packages/db/src/profile.test.ts`:
  - Same-org happy path: track flips, ActivityLog row lands under the
    correct `org_id`.
  - No-op: setting to the current track returns `changed: false`, no log.
  - In-progress attempt blocks the switch (returns `in_progress_work`).
  - In-progress MockSession blocks the switch.
  - Cross-org isolation: even with a crafted `ctx` pointing at user B's
    org_id, the helper only updates the caller's own row (asserted by
    spinning up two orgs and confirming user B's row in org B is unchanged
    when ctx is `{ org_id: orgA, user_id: userAId }`).
- Gate: `pnpm --filter @elc/db test` green.

### Phase 2 — `/profile` route + IELTS track form + header entry

- `app/profile/[[...profile]]/page.tsx` (server component,
  `dynamic = "force-dynamic"`):
  - `requireOrgContext()` → redirect on auth errors (mirrors learner layout).
  - Loads `name`, `email`, `role`, `ielts_track`, `org.name`,
    plus an `inProgress` boolean for any in-progress attempt or mock via
    `withOrg(ctx)`.
  - Renders a brand shell: logo, role-aware back link, sign-out.
  - Sections: "IELTS preference" (`ProfileTrackForm`) and "Password &
    devices" (`ProfilePasswordSection`).
- `components/profile-track-form.tsx` (`"use client"`):
  - Radio group with Academic / General Training, big-target labels, red
    focus ring.
  - Submits via the Phase-1 server action wrapper in
    `apps/web/lib/profile/actions.ts`.
  - Shows the "finish your in-progress X first" copy when the server
    reports `in_progress_work`, *or* preemptively (read from page props
    when `inProgress === true`).
- `components/profile-password-section.tsx` (`"use client"`): mounts
  `<UserProfile routing="path" path="/profile" />` with
  `appearance={profileClerkAppearance}` and only the built-in `security`
  page.
- Header entry: in `(learner)/layout.tsx`, `(admin)/layout.tsx`,
  `(super)/layout.tsx`, wrap the existing name/email block in a `<Link
  href="/profile">` with focus styling.
- Verification: manual sign-in as each seeded role → `/profile` → flip
  track → reload → verify persists → verify Reading/Mock pickers reflect
  the new track. Playwright `profile.spec.ts` covers Learner Academic → GT.
- Gate: Playwright spec passes locally.

### Phase 3 — Clerk `<UserProfile />` mount + appearance overrides

- Extend `clerkAppearance.elements` with any `userProfile*` keys that look
  off-brand out of the box (audit by visiting `/profile` in dev and noting
  the off-brand surfaces). Keep all overrides in one file.
- Manual: change password via the widget, sign out, sign back in.
- Gate: axe-core check on `/profile` reports zero violations.

### Phase 4 — ADR + docs

- `docs/adr/0016-user-profile-management.md` recording D1 + D2 + D3.
- Root `CLAUDE.md`: a one-paragraph mention of `/profile` in the Clerk
  section so future Claude sessions know where password change lives.
- Single PR: `feat(profile): /profile with IELTS track + password (Phase 1–4)`.

## Tenant isolation

- Helper and action read/write only via `withOrg(ctx)`. `user_id` is always
  `ctx.user_id`; nothing flows from the client other than the `ielts_track`
  value, which is enum-validated.
- `ActivityLog` rows land under `ctx.org_id` (the user's own org), action
  namespace `profile.*` — not under `SYSTEM_ORG_ID`.
- Two-org fuzzer test is the contract gate.

## AI cost impact

None.

## Brand impact

- Reuses existing tokens — no new colours, no new fonts.
- Page rhythm: black header (logo + back link + sign-out), section
  headings in Rubik Bold, two-pane card layout for the form similar to the
  auth pages.
- Clerk widget uses `clerkAppearance` so it matches the sign-in / sign-up
  pages.

## Open follow-ups (after ship)

- Display-name edit form (today: Clerk lazy-link name stamp is the only
  sync path in dev).
- Avatar upload via R2.
- Notification preferences (needs schema work).
- Confirm MFA UX once we audit a live signed-in session.

## Risks

- **Track-flip mid-attempt corrupts picker state.** Mitigated by D1 block
  + fuzzer test. Rollback: revert helper and form; data is untouched.
- **Clerk widget styling drift.** Mitigated by `clerkAppearance` in one
  file. Rollback: hide section behind a flag; track form still ships.
- **Header link replaces existing name block on all three role headers
  simultaneously.** Low-risk visual change; rollback is unwrapping the
  Link in each layout (three identical edits).
