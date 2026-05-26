# ADR 0016 — User profile management

- Date: 2026-05-25
- Status: Accepted

## Context

Until now, the only path a user had to change their own IELTS track was to
ask an OrgAdmin to flip it from `/admin/learners`. Password management lived
on Clerk's hosted account portal at a non-branded URL. Both are self-service
expectations on any B2B SaaS, and both shipped as deferred work in earlier
ADRs (0013 / 0014).

This ADR records the decisions made while building the first self-service
profile surface. Scope is intentionally narrow — IELTS track + password
change — so we wire the auth/data pattern once and add name, avatar, MFA,
notification prefs as follow-ups.

The implementation plan is `docs/plans/user-profile-management.md`. The
landing PR is `feat(profile): /profile with IELTS track + password
(Phase 1–4)`.

## Decision

### D1 — Block track switching while in-progress work exists

`updateMyIeltsTrack(ctx, { ielts_track })` returns
`{ ok: false, reason: "in_progress_work" }` when the caller has any
`Attempt` with `status = "InProgress"` or any `MockSession` with
`status = "InProgress"`. The form on `/profile` reads
`hasInProgressWork(ctx)` server-side so the radios + Save button are
already disabled on first paint, and shows the same copy if the server
reports the same reason on submit (in case the user starts a session in
another tab between paint and submit).

Reasons:

- Section pickers and the mock launcher filter approved tests by
  `user.ielts_track`. A silent flip strands the in-progress row behind
  the opposite filter — the learner can only reach it by toggling back.
- "Warn-and-allow" still creates orphan rows; "auto-abandon on switch"
  destroys user work without explicit consent. Block is the least
  surprising option.

The block is per-track, not per-section, which is intentional: a single
in-progress Attempt is reason enough to refuse the switch, even though
in theory a learner could finish a Reading attempt before practising
Writing on the other track. We can soften this later if it bites real
users.

### D2 — `/profile` is a top-level route, not three role-scoped copies

`app/profile/[[...profile]]/page.tsx` sits outside `(learner)/`,
`(admin)/`, and `(super)/`. The page renders its own brand-aligned shell
(logo + role-aware back link + sign-out) and picks the back-link target
from `ctx.role`. The optional catch-all lets Clerk's path-based
`<UserProfile />` subroutes (`/profile/security`, `/profile/account`, etc.)
render inside the same shell and survive reloads:

| Role        | Back-link target |
|-------------|------------------|
| Learner     | `/home`          |
| OrgAdmin    | `/admin`         |
| SuperAdmin  | `/orgs`          |

The page renders the same two sections for everyone: "IELTS preference"
and "Password & devices". Trade-off accepted: the role-specific header
(with its nav strip / console label) is replaced on `/profile` with a
simpler shell. The win is that the form, the server action, and the
appearance overrides live in one place. Rollback path if we ever need
role-specific headers back: move the page into each `app/(role)/profile/`
folder — one move per role, no logic change.

The three role layouts gained a "Profile" entry point:

- `(learner)/layout.tsx` and `(admin)/layout.tsx`: the existing
  name/email/org block in the header is now a `<Link href="/profile">`
  with a hover ring.
- `(super)/layout.tsx`: a new `<Link href="/profile">Profile</Link>` in
  the nav row, between "Content" and the sign-out control. The super
  header has no existing name block to wrap.

### D3 — Tenant isolation via `withOrg(ctx)` end-to-end

The DB helper (`packages/db/src/profile.ts`) reads and writes only via
`withOrg(ctx)`:

- `withOrg(ctx).user.findUnique({ where: { id: ctx.user_id } })` — the
  proxy injects `org_id = ctx.org_id`, so a crafted ctx that points at
  org A but carries user B's id finds nothing and returns
  `invalid_track`.
- `withOrg(ctx).user.update({ where: { id: ctx.user_id }, data: { ielts_track } })`
  — same isolation.
- `withOrg(ctx).activityLog.create(...)` — the proxy overrides `org_id`
  in the data payload to `ctx.org_id`.

`ActivityLog` row lands under the user's own org (`ctx.org_id`), action
namespace `profile.*`. Not under `SYSTEM_ORG_ID` — this is an in-org
event, not a super-level moderation event (see
`.claude/rules/multi-tenancy.md`).

The two-org fuzzer in `packages/db/src/profile.test.ts` is the contract
gate. It includes a "crafted ctx" case that asserts user B's row in
org B is untouched when ctx is `{ org_id: orgA, user_id: userBId }`.

### D4 — `<UserProfile />` exposes only password + session management

`profile-password-section.tsx` mounts Clerk's `<UserProfile />` with
`routing="path"`, `path="/profile"`, a profile-specific extension of the
existing `clerkAppearance` object, and only `<UserProfile.Page
label="security" />`. Clerk's element class keys
(`card`, `headerTitle`, `formButtonPrimary`, etc.) are shared across
`<SignIn>`, `<SignUp>`, and `<UserProfile />`, so the widget inherits the
brand. The profile-specific overrides hide the vendor sidebar/header,
remove the account/email/connected-account pages, and hide the delete-account
security row. Direct visits to blocked Clerk subroutes such as
`/profile/account` redirect back to `/profile/security`.

The widget is wrapped in Clerk's `<Show when="signed-in">` so the
dev-cookie-only session (`/dev/login`) sees a clear fallback line
instead of a blank or partially-rendered widget. This keeps the
Playwright spec for `/profile` testable without standing up a full
Clerk session.

### D5 — `ActivityLog` action name `profile.track_changed`

Two existing namespaces touch the same row: `learner.updated` (when an
OrgAdmin flips a learner's track via `/admin/learners`) and now
`profile.track_changed` (when the learner flips their own). Keeping
them distinct is deliberate — an audit query for "self-service changes
this month" must not be polluted by admin-driven edits, and vice
versa. Metadata shape is `{ from, to }` (no `target_user_id`, because
the actor and the target are always the same row).

## Consequences

### Good

- Self-service IELTS track + password change ships in one PR for all
  three roles. No new schema, no migration.
- Tenant isolation extended to a new write surface with a fuzzer-style
  test in the same shape as `org-learner-admin.test.ts`.
- `<UserProfile />` reuses and extends the existing `clerkAppearance`
  map — no brand drift between `/sign-in`, `/sign-up`, and `/profile`.
- Stranded-in-progress-work failure mode that bit us in early UX
  testing is now impossible by construction.

### Bad

- `/profile` does not share the role-specific header (D2). If we ever
  need role-specific chrome on this page, the move is straightforward
  but it does touch three folders.
- We rely on Clerk appearance element keys for hiding the delete-account
  row. If Clerk renames those keys in a future SDK, the row could reappear
  and should be caught in visual QA.
- The block-on-in-progress rule (D1) is per-track, not per-section. A
  learner with one in-progress Reading attempt can't switch tracks
  even though Reading is the only section affected. Acceptable for v1;
  revisit if real users complain.

## Follow-ups

- Confirm MFA UX once we audit a live signed-in session.
- Add a display-name edit form. Today, name comes from Clerk's
  lazy-link stamp (ADR-0014 D2).
- Avatar upload (needs R2 path).
- Notification preferences (needs schema work — new table or a
  jsonb column on `User`).
- Consider softening D1 to a per-section block if user research shows
  the cross-section block is frustrating.
