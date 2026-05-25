# ADR 0014 — Clerk login experience

- Date: 2026-05-25
- Status: Accepted

## Context

ADR 0013 shipped the OrgAdmin dashboard as a thin slice with no email
delivery: `inviteLearnerForOrg` created a dormant `User` row keyed by
email, and the admin shared the sign-in link out-of-band. The ADR
flagged "wire Clerk; replace `requireOrgContext` cookie path with Clerk
session; add a claim-invite landing that matches by email" as the
follow-up.

This ADR records the decisions made when actually wiring that
follow-up. The cookie-based dev session is still present as a dev-only
escape hatch (`/dev/login` + the signed `elc_dev_session` cookie); Clerk
is the canonical auth backend in both dev and production.

The plan that scoped this work is
`docs/plans/clerk-login-experience.md`. Phases 1–5 of that plan are
committed to `main` as `feat(auth):` / `feat(brand):` commits between
`baf9a03` and `8195f38`.

## Decision

### D1 — DB is the source of truth for org membership and role; Clerk for identity and sessions only

Clerk has its own organization model (`organizationMembership`,
`org_admin` / `basic_member` roles). We use only the parts that buy us
something we don't already have: identity (a stable `userId`),
authenticated sessions, OAuth providers, and invitation email delivery.

Org membership, role (`SuperAdmin` / `OrgAdmin` / `Learner`),
`ielts_track`, `deleted_at`, seat limits, and quota all live in our DB
and are authoritative. `requireOrgContext` reads `org_id` from the
matched `User` row, never from a Clerk session claim. Webhook handlers
in `packages/db/src/clerk-sync.ts` keep `Organization.clerk_org_id` and
`User.clerk_user_id` in sync with their Clerk counterparts; they do
**not** promote anyone past `OrgAdmin`.

Trade-off accepted: we maintain a small clerk-sync surface ourselves
instead of leaning on Clerk's role primitives. The win is that a Clerk
role change (or a Clerk-side outage that desyncs membership) can never
silently elevate a Learner inside our app — our DB write is the only
path to a role bump.

### D2 — Lazy-link by email on first Clerk sign-in (and sync the name while we're there)

When a Clerk-authed user has no DB row matching their `clerk_user_id`,
`loadUserForClerkId` looks the row up by email, stamps `clerk_user_id`,
and **also stamps `name` from Clerk's `firstName + lastName` when
present**. This covers three cases with one path:

1. Seeded users (e.g. `super@elanguage.dev`) signing in via Clerk for
   the first time after `pnpm db:seed` ran `seedClerkIdentities()`.
2. Invited users (D3) whose DB row was created by an OrgAdmin before
   they ever visited the site.
3. Webhook-created rows where the `user.created` event somehow beat
   our request to its destination.

The name sync was added during Phase 4 (commit `b41baa7`) because
the seed's generic placeholders ("Super Admin", "Demo English Admin")
were leaking through to the role greeting on `/orgs` and `/admin`.
In dev there's typically no public webhook URL, so the
`user.updated` event that would otherwise sync the name on every
sign-in never reaches `applyClerkUserUpsert`; the lazy-link is the
only guaranteed sync point.

A Clerk-authed user with no DB match (or whose row is soft-deleted)
gets `NoOrgMembershipError` and is routed to `/no-access`. We refuse
to auto-create a User row under some default org — org membership is
an OrgAdmin decision.

### D3 — Invitations: DB row first, then Clerk, with rollback on hard Clerk failure

`inviteLearnerForOrg` creates the DB User row in the same
seat-limit-checked transaction as before (ADR 0013 D3), then calls
`clerkClient.invitations.createInvitation`. The shape of the call:

```ts
await clerk.invitations.createInvitation({
  emailAddress: email,
  redirectUrl: `${APP_URL}/sign-up`,
  publicMetadata: { org_id, role: "Learner" },
});
```

Three Clerk responses get special handling:

- **422 `duplicate_record`** → treat as success. The DB row exists; the
  admin's "re-invite" UX must stay idempotent. Clerk's invitation /
  account is already there.
- **429** → sleep 2 s, retry once. On a second 429, return the new
  `clerk_rate_limited` failure reason. Surfaces to the admin via
  `InvitePanel`'s copy.
- **5xx** → return `cannot_invite` AND `prisma.user.delete` the row.
  An unsent invitation must not leave an orphan Learner sitting in
  the roster.

`ActivityLog` is written only after a successful Clerk call. The Clerk
call is deliberately *outside* the create-User transaction: holding a
Postgres transaction open across an HTTP round-trip to Clerk would
break the seat-limit guarantee under load. The rollback path is a
manual `prisma.user.delete` inside the same request.

5 vitest cases cover the Clerk behaviour
(`packages/db/src/admin-invite.test.ts`): success, 422-duplicate,
429-retry-success, 429-retry-fail-then-rate-limited, 5xx-rollback. The
fake Clerk errors are real `ClerkAPIResponseError` instances so the
runtime guard in `@clerk/backend/errors` accepts them.

### D4 — `redirectUrl` is `/sign-up`, not `/post-signin`

The plan's literal text said `redirectUrl: ${APP_URL}/post-signin`.
That doesn't work: Clerk's invitation flow validates the ticket and
then redirects to the URL with `__clerk_ticket` in the query string.
`<SignUp>` is the component that reads that query, prefills the email,
and binds the new Clerk account to the invitation. `/post-signin`
doesn't know how to do any of this — it would see no Clerk session,
throw `UnauthenticatedError`, and bounce the invitee to `/sign-in`
with no ticket attached (we observed this during Phase 2 verification).

Final shape: invitation link → `/sign-up?__clerk_ticket=...` →
`<SignUp>` creates the Clerk account → `/sign-up`'s
`fallbackRedirectUrl="/post-signin"` → role routing → role home.

### D5 — `/post-signin` redirects via `window.location.replace`, not Server-Component `redirect()`

`<SignIn>` and `<SignUp>` finish by client-side-navigating to
`/post-signin`. On Next 16 App Router with Clerk v7, Server-Component
`redirect()` returns an RSC-payload navigation that Clerk's
`ClerkProvider` client wrapper sometimes drops — the dev-server log
shows the destination page being fetched server-side, but the browser
tab stays on `/post-signin` showing the loading state until the user
hits refresh. `useRouter().replace()` has the same failure mode.

`apps/web/app/post-signin/post-signin-redirector.tsx` is a small client
component that calls `window.location.replace(to)` for a hard browser
navigation Clerk has no hook into. The cost is one extra HTTP round-
trip per sign-in, which is invisible in practice. The error-paths
(`UnauthenticatedError → /sign-in`, etc.) keep server-side `redirect()`
because they only fire before any Clerk client context exists.

### D6 — Clerk's organization role keys must use the `org:` prefix

Clerk's Backend API rejects the unprefixed legacy names (`"admin"`,
`"basic_member"`) with `404 "Organization role not found"` on
instances created after the role-key change. We always pass
`"org:admin"` from `seedClerkIdentities()`. The constant is asserted in
`clerk-seed.test.ts`; dropping the prefix is a regression that fails
the unit test before it ships.

### D7 — Learners get NO Clerk organization membership

`requireOrgContext` reads `org_id` from our DB User row, so a Clerk
membership for a Learner would be unused state that drifts (e.g. a
soft-deleted Learner stays "in" the Clerk org forever, because we
don't propagate `deleted_at` to Clerk). `seedClerkIdentities()` skips
the membership pass for Learners by design; the count is reported as
`learnerMembershipsSkipped` in its result and asserted in the seed
unit test.

SuperAdmin gets exactly **one** Clerk membership — their home org (the
one their User row points at, Org A in the standard seed). Their
cross-org powers come from the DB `role` column, not from being in
every Clerk org.

**Operational implication:** the Clerk dashboard must be configured
with **Configure → Organizations Settings → Membership optional**.
The default ("Membership required") forces every Clerk-authed user to
join or create an org before they can proceed, which would block
Learners at Clerk's setup wizard. Recorded here so a future Clerk
project re-init doesn't reintroduce the gate.

### D8 — Required env vars

Anything that touches Clerk needs these. All five live in
`packages/db/.env` so `apps/web/next.config.ts`'s `loadEnv` picks
them up alongside the Prisma URLs:

| Env | Used by | Required when |
|---|---|---|
| `CLERK_SECRET_KEY` | backend SDK (seed, invite, webhook verify) | always |
| `CLERK_PUBLISHABLE_KEY` | `<ClerkProvider>` on the client | always |
| `CLERK_WEBHOOK_SIGNING_SECRET` | webhook Svix signature check | when running with the webhook receiver |
| `APP_URL` | invitation `redirectUrl` build | any code path that calls `inviteLearnerForOrg` (throws `InviteEnvError` otherwise) |
| `SEED_DEFAULT_PASSWORD` | overrides the shared seed password | optional; defaults to `elanguagecenter2026!` in `clerk-seed.ts` |

`seedClerkIdentities()` refuses to run if `NODE_ENV=production` OR
`CLERK_SECRET_KEY` is unset (belt + braces against running the seed
against a real Clerk tenant). The escape hatch `SEED_SKIP_CLERK=1`
short-circuits the whole function for offline dev.

## Consequences

### Good

- Sign-in, sign-up, invitation, and lazy-link all work end-to-end for
  the four canonical roles (SuperAdmin / OrgAdmin / Learner / invitee).
- Verification gates: `pnpm --filter @elc/db test` 112/112 green;
  `pnpm --filter web test:e2e` 7/7 green (3 role-greeting + 2 a11y +
  2 existing suspend-gate). Manual end-to-end sign-in confirmed for
  the three seeded role accounts and one invited Gmail.
- Brand: `/sign-in`, `/sign-up`, and `/post-signin` are on-brand;
  axe finds zero WCAG 2.1 AA violations on either auth page.
- DB stays source of truth — a Clerk outage or role change cannot
  silently elevate a user.

### Bad

- The `/post-signin` client-side redirect is a Clerk-vs-Next-router
  workaround. If a future Clerk or Next version fixes the underlying
  RSC-redirect handling we should revert to Server-Component
  `redirect()` (cleaner, no extra round-trip). Pinned in the file's
  header comment so reverters know the precondition.
- Two Clerk dashboard settings are operationally required and don't
  live in version control: "Membership optional" and
  "Sign-in verification off for new device" (the latter is dev-only —
  Clerk's per-email code can't be received at `@elanguage.dev` mailboxes
  during development). A fresh Clerk project re-init needs both.
- The lazy-link only fires when `clerk_user_id` is null. Users who
  linked before commit `b41baa7` still carry their pre-link `name`
  field; resync via `packages/db/scripts/resync-name-from-clerk.ts`.

## Follow-ups

- Wire CI for `pnpm --filter web test:e2e` so the role-greeting and
  a11y specs guard against regressions on PRs. Today they only run
  when invoked manually.
- Retire the `/dev/login` cookie path once Clerk is the only path used
  in any environment we run tests against. The path still exists for
  the suspend-gate Playwright spec and as an offline-dev escape hatch.
- Consider promoting the `resync-name-from-clerk.ts` script into a
  scheduled `pnpm db:resync-names` if name drift becomes a recurring
  thing (currently a one-off cleanup tool).
- Webhook ordering: Clerk's out-of-order delivery can silently drop
  `organization.deleted` events; tracked separately in the project's
  memory.
