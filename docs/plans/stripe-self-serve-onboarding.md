# Plan: Self-Serve Org Onboarding + SuperAdmin Invite + Tiered Subscriptions via Stripe

> Status: **Phases 0–8 shipped.** Last updated 2026-05-31.
> Phase 0 (multi-org schema + sync + auth resolution + fuzzer) landed
> 2026-05-31 (`8e2d55a`, `0533e2e`). The OrgAdmin `<OrganizationSwitcher>`
> is now wired into `(admin)/layout.tsx` (gated on `MULTI_ORG_ENABLED`,
> with in-switcher org-creation hidden so it can't bypass the billing
> funnel). To turn multi-org on, set `MULTI_ORG_ENABLED=1` in
> `packages/db/.env`. Remaining: the full two-account browser funnel test,
> operational hardening, the tenancy audit P2 follow-ups below, and the
> ADR-0018 UI follow-ups (SuperAdmin "view a user's orgs", in-app leave).
> Earlier note: three local commits were once blocked by an iCloud mmap
> issue — see `memory/icloud-node-modules-corruption.md` if `git push`
> fails with `fatal: mmap failed`.

## Enabling multi-org (operator runbook)

Phase 0 shipped the schema, sync, and auth resolution, and the OrgAdmin
`<OrganizationSwitcher>` is wired into `(admin)/layout.tsx`. All of it is
**dormant behind one feature flag** until you flip it. To turn multi-org
on:

1. **Set the flag.** Add `MULTI_ORG_ENABLED=1` to `packages/db/.env`.
   - This file is **git-ignored and protected from tooling** (agents get a
     deny-rule error trying to write it) — edit it by hand.
   - `next.config.ts` forwards it to the app; both the self-serve guard
     (`self-serve.ts`, `signup-org/continue`) and the admin switcher read
     `process.env.MULTI_ORG_ENABLED === "1"`.
   - For Vercel/prod: add `MULTI_ORG_ENABLED=1` to the project env vars.
2. **Restart the dev server** (env is read at boot, not per-request).
3. **Run the two-account acceptance test in a browser** (ADR-0018 — the
   automated suites cover schema/sync/auth, but the live Clerk
   multi-membership flow can only be exercised manually):
   1. Sign up Org A via `/signup-org`, complete onboarding.
   2. Sign out, sign up Org B with the **same Clerk account** + a new org
      name.
   3. Confirm you land on `/select-org`, can pick either org, and reach the
      correct dashboard for each.
   4. In `/admin`, confirm the `<OrganizationSwitcher>` appears, flips the
      active org, and that "Create organization" is **absent** from its
      popover (org creation must stay on `/signup-org` / `/orgs/new` so it
      lands on a Plan + billing).
4. **Rollback** is just removing the flag (and re-adding the `@unique`
   constraints if you need a hard schema revert — safe as long as no
   second-org User rows were created while the flag was on; see ADR-0018
   D5).

Behaviour with the flag **off** (default): single-org enforced, self-serve
refuses duplicate emails with `email_already_in_use`, switcher hidden.
Learners stay single-org **regardless** of the flag, by convention.

## Resumption checklist (post-Mac-restart)

1. `git log --oneline -5` — confirm the three local commits are still there:
   - `22cf179` — fix(tenancy): route onboarding User read through withOrg(ctx) — audit F1
   - `f66fdab` — docs: Phase 8 cleanup — sync CLAUDE.md, BRIEF.md, ADR-0017/0018 to shipped state
   - `068b7d9` — fix(billing,profile): /admin/billing routing + actionable CTAs + hide IELTS for non-Learners
2. `git push origin main` — if it works, great. If `fatal: mmap failed`, see
   `memory/icloud-node-modules-corruption.md` for the workarounds (toggle
   iCloud Drive off, or move the project out of `~/Documents/`).
3. Once pushed, decide on next phase:
   - **Phase 0 — Multi-org schema** (drops `User.email @unique`, lets existing
     users self-serve a second Org; see ADR-0018).
   - **Operational hardening** — Stripe Checkout/Portal branding upload, prod
     webhook config, disposable-email blocklist on `/signup-org`, soft rate
     limit on `provisionSelfServeOrg`.
   - **Tenancy audit P2 follow-ups** — `applyTrialWillEnd` missing
     `metadataMatches` check, `activateFreePlanForOrg` raw-prisma ActivityLog
     write, `trySyncPlanToStripe` fabricated ctx. See the audit report in the
     prior session.

## Goal

Stand up **two parallel onboarding funnels for new orgs**:

1. A public **self-serve flow** from `/pricing` → inline Clerk sign-up + org
   name + plan pick → 14-day-trial Stripe Checkout.
2. The existing **SuperAdmin invite flow** for hand-sold customers.

Both funnels converge on the same Plan catalogue, Stripe Checkout machinery,
and webhook activation path. SuperAdmin manages a tiered Plan catalogue
(Free / Starter / Pro / Enterprise) in the admin console; the DB is the
source of truth and we push Products + Prices to Stripe. OrgAdmins get a
Stripe Billing Portal link from `/admin/billing`. Existing orgs are
grandfathered onto a non-billed `Internal` plan.

**Roadmap deviation.** `docs/BRIEF.md` §13 ("Phase 2 Roadmap") lists Stripe
self-serve billing as Phase 2. This plan pulls it forward into MVP-v1 and
also adds the public self-serve funnel that wasn't on the original roadmap
at all. ADR-0017 records the trade-off explicitly. ADR-0018 records the
multi-org user-membership schema reversal that self-serve requires.

## Scope

### IN

- SuperAdmin CRUDs Plans in `(super)/plans/`; on save we idempotently push
  Stripe Products + monthly recurring Prices.
- SuperAdmin invites an OrgAdmin by email tied to a pre-created Org.
- Public `/pricing` page + `/signup-org` combined Clerk-sign-up + org-name
  + plan-pick form.
- `/onboarding/plan` wizard (shared between both funnels for the pay step).
- Stripe Checkout in `subscription` mode with `trial_period_days: 14` and
  card required.
- Stripe webhook handler at `/api/stripe/webhook` with `StripeEventLog`
  idempotency table.
- Stripe Billing Portal link from `/admin/billing`.
- **Multi-org membership**: one Clerk user can belong to multiple Orgs,
  one DB User row per Org. Learners stay single-org by convention.
- Grandfather migration: existing non-system Orgs assigned to the
  `Internal` plan, no Stripe customer.
- Reuse existing Suspended-org gate for `Canceled`/`PastDue`-bottom-out.

### OUT (deferred / not now)

- Free / no-card trial (we chose card-required).
- Per-seat metered billing.
- Annual billing toggle in v1 (schema leaves room via
  `stripe_price_id_yearly?`).
- Mid-cycle plan-change UI in our app — defer to Stripe portal.
- Bespoke Enterprise quote / contract flow — Enterprise tier ships as a
  fixed-price Checkout in v1.
- Stripe Tax / VAT — USD-only assumption, flag for legal.
- Domain allowlist / disposable-email blocking (rely on Clerk email verify
  + Stripe Fraud Radar in v1).
- Cohort / team management UI for multi-org users beyond Clerk's built-in
  `<OrganizationSwitcher>`.
- Email notifications beyond what Stripe sends natively (trial-ending,
  invoice).

## P0 resolutions (locked)

These were the open P0s in the plan handoff. Recorded here so future
sessions don't relitigate them.

### P0 #1 — `OrgStatus` vs `subscription_status` split

Keep `OrgStatus { Active, Suspended, Archived }` as today — it remains the
moderation/lifecycle column. Add a separate **`subscription_status`**
enum on `Organization`:

```
Trialing | Active | PastDue | Canceled | Incomplete | Internal | PendingPayment
```

The two intersect on `Suspended ↔ Canceled` (webhook sets both when a
subscription is cancelled), but the split keeps the SuperAdmin's
"Suspend for T&C violation" path coherent with the "Stripe cancelled,
suspend automatically" path.

### P0 #2 — Self-serve org name uniqueness

**Allow** duplicates (real schools share names). The Organization `id` is
the only key. SuperAdmin's `/orgs` list surfaces a small "name collision"
chip when two active orgs share a name so it's visible at a glance.

### P0 #3 — Free tier (tagline tension resolution)

The brand tagline is "Free. Fun. Effective." but every paid plan requires
a card. Resolution: **ship a `Free` plan** alongside Starter/Pro/Enterprise.
The Free plan has:

- 1 active learner seat
- Conservative daily/monthly quota (50 / 300)
- `is_internal: false`, `amount_monthly_usd: 0`
- No Stripe Product / Price (`stripe_product_id` stays null)
- Special-cased in the self-serve and invite flows: skipping Stripe
  Checkout, activating the Org immediately on plan pick

The public `/pricing` page leads with Free → Starter → Pro → Enterprise so
the tagline lands honestly.

### P0 follow-up on D5 (billing-owner OrgAdmin)

For an Org with multiple OrgAdmins, the **billing-owner** is the user who
created the Org via self-serve, or the first invited OrgAdmin. Stored on
`Organization.billing_owner_user_id`. Only the billing owner can open the
Stripe Portal; other OrgAdmins on the Org see `/admin/billing` (plan,
status, next renewal) but the "Manage billing" button is disabled with a
tooltip pointing at the owner.

## Decisions also locked

- **Self-serve funnel shape:** Pricing page → pick plan → sign-up + org
  details inline → Checkout. (User pick.)
- **Trial:** Card-required, 14-day trial via Stripe `trial_period_days`.
- **Self-serve primary, SuperAdmin invite secondary.** Both funnels live.
- **Existing user creating new org:** Allow — same Clerk user, second DB
  User row in the new Org. Requires multi-org schema work (Phase 0).
- **Plan source of truth:** DB → push to Stripe.
- **Org provisioning timing for invite path:** SuperAdmin creates Org +
  invites admin (current model, with Org starting in `PendingPayment`).

## Affected layers

- **DB schema**
  - New global `Plan` model (NOT tenant-scoped).
  - `Organization` gains `plan_id`, `stripe_customer_id @unique`,
    `stripe_subscription_id @unique`, `subscription_status`,
    `current_period_end`, `trial_end`, `billing_owner_user_id`,
    `provisioned_via` (`invite` | `self_serve` | `seeded`).
  - `User`: drop `email @unique` and `clerk_user_id @unique`; add
    `@@unique([org_id, email])` and `@@unique([org_id, clerk_user_id])`.
  - New `StripeEventLog` table for webhook idempotency
    (`stripe_event_id @unique`, `received_at`).
- **API / Server Actions**
  - `apps/web/app/api/stripe/webhook/route.ts`
  - `apps/web/lib/super/plan-actions.ts`
  - `apps/web/lib/super/org-actions.ts` (extended)
  - `packages/db/src/admin-invite-orgadmin.ts` (parallel to learner invite)
  - `apps/web/lib/onboarding/{plan,checkout,return,self-serve}.ts`
  - `apps/web/lib/billing/{stripe-client,portal}.ts`
  - `packages/db/src/clerk-sync.ts` (multi-org-aware update fan-out)
  - `apps/web/lib/auth/context.ts` (`requireOrgContext` — active Clerk
    Org → matching DB User row)
- **UI**
  - `(super)/plans/` — list + new + `[planId]`
  - `(super)/orgs/new` — Plan select + OrgAdmin email
  - `(super)/orgs/[orgId]` — show plan, subscription status, resend
    invite, name-collision chip
  - `app/(public)/pricing/page.tsx` — public unauth pricing page
  - `app/signup-org/page.tsx` + `app/signup-org/continue/page.tsx` —
    Clerk sign-up + org-name step
  - `app/(onboarding)/plan/page.tsx`, `/processing/page.tsx`,
    `/welcome/page.tsx`
  - `app/(admin)/billing/page.tsx`
  - `app/(admin)/layout.tsx` — Clerk `<OrganizationSwitcher>` in header
  - `/post-signin` — extend role routing for `PendingPayment` +
    self-serve return paths
- **AI gateway** — no call-path changes; plans drive
  `Organization.quota_daily` / `quota_monthly` via webhook write-through.
- **Background jobs** — none in v1 (post-MVP: daily cleanup of stranded
  `PendingPayment` orgs).
- **Tests**
  - Unit: plan CRUD, Stripe-stub product sync, OrgAdmin invite,
    self-serve provisioning, webhook signature + dispatch +
    idempotency, multi-org `requireOrgContext`.
  - Tenancy fuzzer: `Plan` is global; multi-org `(email, org_id)`
    doesn't leak between orgs; webhook lookup by `stripe_customer_id`
    is monotonic forward-progress only.
  - E2E (Playwright): both funnels end-to-end against Stripe test mode
    + Stripe CLI webhook replay.
- **Docs**
  - `docs/adr/0017-stripe-self-serve-onboarding.md`
  - `docs/adr/0018-multi-org-user-membership.md`
  - `CLAUDE.md` — new "Billing & plans" section + update Auth section
    for multi-org
  - `docs/adr/0014-clerk-login-experience.md` follow-up note —
    multi-org membership partially supersedes D7 for OrgAdmins;
    Learners still single-org

## Phases (each with a verification gate)

Phases 0 and 1 are independent and can land in either order. Phase 0 is
required before Phase 6 ships. Phases 2–5 chain. Phases 6–8 chain.

### Phase 1 — Plan catalogue (DB-only, no Stripe yet) ← START HERE

Lowest-risk foundational work. Independent of Phase 0.

- Prisma `Plan` model: `id`, `slug @unique`, `name`, `description`,
  `seat_limit`, `quota_daily`, `quota_monthly`, `amount_monthly_usd`
  (Decimal), `currency` (`"usd"`), `trial_days` (default 14),
  `is_internal` (bool), `is_active` (bool), `sort_order`,
  `stripe_product_id?`, `stripe_price_id_monthly?`, timestamps.
- `Organization` gains the billing columns listed above.
- `subscription_status` enum added.
- `StripeEventLog` model.
- Migration generated.
- Seed: upsert `free`, `starter`, `pro`, `enterprise`, `internal`. Backfill
  existing non-system Orgs to the `internal` plan with
  `subscription_status: Internal`.
- SuperAdmin pages: `/plans`, `/plans/new`, `/plans/[planId]`. Reads via
  `withSuperAdminContext`, ActivityLog rows under `SYSTEM_ORG_ID`
  (`super.plan.created` / `updated` / `archived`).
- DB helpers in `packages/db/src/plans.ts` with the same shape as
  `profile.ts` (input Zod, structured-result return, ActivityLog dual-
  write).
- Verification: unit tests for plan-actions validation, tenancy fuzzer
  green (Plan is NOT in `TENANT_SCOPED_MODELS`), manual CRUD against
  the dev DB.
- **Gate:** Plans can be created and listed; existing orgs visibly on
  the `Internal` plan in `/orgs/[orgId]`; no Stripe wiring yet.

### Phase 0 — Multi-org user membership (must land before Phase 6)

Substantial but mechanical schema migration plus auth refactor. Ships
behind `MULTI_ORG_ENABLED=1` feature flag so we can roll back without
a schema revert.

- Drop `User.email @unique` and `User.clerk_user_id @unique`. Add
  `@@unique([org_id, email])` + `@@unique([org_id, clerk_user_id])`.
- Update `packages/db/src/clerk-sync.ts`:
  - `applyClerkUserUpsert` iterates **all** DB User rows with the given
    `clerk_user_id` and updates each.
  - `applyClerkUserDeleted` soft-deletes them all.
- Update `apps/web/lib/auth/context.ts → requireOrgContext`:
  - Read the active Clerk Org from session.
  - Find DB User row matching `(clerk_user_id, active_org_id)`.
  - If no DB row but `(email, active_org_id)` exists, lazy-link and
    stamp `clerk_user_id`.
  - If multiple Clerk memberships but no active Clerk Org (edge case),
    redirect to `/select-org`.
- New `/select-org` page using Clerk `<OrganizationList />`.
- Update `packages/db/src/admin-invite.ts` (learner invite): the
  cross-org email block becomes scoped — `(email, org_id)` already
  exists in this org → refuse; same email in another org → allow.
- Add Clerk `<OrganizationSwitcher>` to `(admin)/layout.tsx`.
- Extend tenancy fuzzer: two orgs sharing an email, assert zero leakage.
- Verification: unit tests for multi-row clerk-sync fan-out; manual sign-
  in for an existing seeded user (single-org case must still work).
- **Gate:** Existing single-org behaviour unchanged; schema *can*
  support multi-org but no path creates a second row yet. ADR-0018 lands.

### Phase 2 — Stripe SDK + Product sync (DB → Stripe push)

- Add `stripe` SDK; centralise client in
  `apps/web/lib/billing/stripe-client.ts`.
- Assert `STRIPE_SECRET_KEY` starts with `sk_test_` outside production
  (mirrors `clerk-seed.ts` guard).
- On plan create/update in `(super)/plans/...`, idempotently upsert
  Stripe Product (by `metadata.plan_slug`) and recurring Price; store
  ids back on the Plan row.
- "Re-sync to Stripe" button on plan detail page.
- `is_internal` and `free` plans never sync to Stripe.
- New `BillingEnvError` modelled on `InviteEnvError`.
- Verification: stub-backed unit tests (mirroring `admin-invite.test.ts`
  pattern) for create / update / re-sync / internal-skip / free-skip;
  manual against Stripe test mode.
- **Gate:** All non-internal, non-free plans have non-null
  `stripe_product_id` + `stripe_price_id_monthly`.

### Phase 3 — SuperAdmin invite flow (OrgAdmin)

- New `packages/db/src/admin-invite-orgadmin.ts` (parallel to
  `admin-invite.ts`).
- `/orgs/new`: SuperAdmin picks Plan + (optionally) enters OrgAdmin
  email. Org initial state: `subscription_status: PendingPayment`
  unless plan is Free / Internal.
- Clerk Org created server-side at org-create time (mirrors
  `clerk-seed.ts` `clerk.organizations.createOrganization`) so the
  invitee has an org to attach to on first sign-in.
- Invitation `publicMetadata`: `{ org_id, role: "OrgAdmin" }`. Webhook
  promotes on `user.created`.
- `billing_owner_user_id` stamped on the new DB User row (the first
  OrgAdmin invited for the Org).
- Verification: unit tests; manual invite→accept→sign-in flow.
- **Gate:** Invited OrgAdmin signs in; routing to `/onboarding/plan` is
  Phase 5's job.

### Phase 4 — Stripe webhook + activation

Promoted ahead of the wizard so we can test activation in isolation
against `stripe trigger`.

- `apps/web/app/api/stripe/webhook/route.ts` with Stripe signature
  verification using `STRIPE_WEBHOOK_SIGNING_SECRET`.
- `StripeEventLog` write-then-act idempotency.
- Events handled in v1:
  - `checkout.session.completed` — stamp `stripe_subscription_id`,
    `stripe_customer_id`.
  - `customer.subscription.created` / `updated` — sync
    `subscription_status`, `current_period_end`, `trial_end`; copy
    `plan.seat_limit / quota_daily / quota_monthly` to Org. First
    transition into `trialing` or `active` flips `OrgStatus → Active`.
  - `customer.subscription.deleted` — `OrgStatus → Suspended`,
    `subscription_status → Canceled`.
  - `invoice.payment_failed` — `subscription_status → PastDue`,
    `OrgStatus` unchanged until Stripe smart-retry bottoms out.
  - `customer.subscription.trial_will_end` — ActivityLog row only; UI
    surfaces "Trial ending in N days" banner.
- Multi-tenancy belt-and-braces: every Stripe Customer + Subscription
  stamps `metadata.org_id`; webhook asserts
  `customer.metadata.org_id === lookup.org_id`, throws on mismatch.
- ActivityLog dual-write: `super.subscription.*` under `SYSTEM_ORG_ID`
  + `subscription.*` under the customer org.
- Use `event.created` monotonic ordering check before any state
  downgrade (echoes the [webhook-ordering-followup]
  (../memory/webhook-ordering-followup.md) memory).
- Verification: signature failure rejected; idempotent replay no-op;
  out-of-order events ignored; E2E with `stripe trigger` +
  `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
- **Gate:** Webhook handles activation correctly against a hand-
  created Checkout session.

### Phase 5 — Onboarding wizard (shared post-pay surface)

- `/post-signin` adds branches:
  - `OrgAdmin + subscription_status === PendingPayment` →
    `/onboarding/plan`.
  - Other cases unchanged.
- `/onboarding/plan` lists active non-internal Plans as branded cards.
  Each form posts to a server action that:
  1. Creates Stripe Customer if missing
     (`metadata: { org_id, billing_owner_user_id }`).
  2. Creates Checkout Session in `subscription` mode with the selected
     `price`, `subscription_data: { trial_period_days: <plan.trial_days> }`,
     `success_url=/onboarding/processing?session_id={CHECKOUT_SESSION_ID}`,
     `cancel_url=/onboarding/plan?canceled=1`.
  3. 303-redirects to the Checkout URL.
  4. **Free plan exception:** skip Stripe, set
     `subscription_status: Internal`, `OrgStatus: Active`, redirect
     straight to `/onboarding/welcome`.
- `/onboarding/processing` polls Org row until
  `subscription_status ∈ { Trialing, Active }`, then forwards to
  `/onboarding/welcome` → `/admin`.
- Layout middleware: `PendingPayment` is distinct from `Suspended`.
  PendingPayment routes only `/onboarding/*` and `/sign-out`.
- Verification: manual end-to-end for the invite funnel with a Stripe
  test card → Trialing Org reaches `/admin`.
- **Gate:** Invite-funnel orgs complete onboarding and reach `Trialing`.

### Phase 6 — Self-serve signup funnel (requires Phase 0)

- `/pricing` (public, unauth): three branded tier cards. CTA →
  `/signup-org?plan={slug}`.
- `/signup-org` (public, unauth): Clerk `<SignUp>` with
  `afterSignUpUrl="/signup-org/continue?plan={slug}"`.
- `/signup-org/continue` (auth required, no DB User yet): one-field
  form "Organisation name". Hidden `plan` slug. Server action
  `selfServeProvisionOrg`:
  1. Validate plan slug → active, non-internal Plan.
  2. Create Clerk Organization (`createOrganization({ name,
     createdBy: clerkUserId })`).
  3. Create DB `Organization` row (`subscription_status:
     PendingPayment` for paid; `Internal` for Free; `OrgStatus:
     Active`, `plan_id`, `provisioned_via: self_serve`).
  4. Create DB `User` row (`role: OrgAdmin`, `org_id`, `clerk_user_id`,
     `email`).
  5. Create Clerk Org membership (role `"org:admin"`).
  6. Stamp `billing_owner_user_id` on the Org.
  7. ActivityLog: `org.self_serve_created` under the new org_id +
     `super.org.self_serve_created` under `SYSTEM_ORG_ID`.
  8. Redirect to `/onboarding/plan?preselect={slug}` (or
     `/onboarding/welcome` for Free).
- Existing-user case (multi-org): if Clerk user already has DB rows
  in other orgs, just create the additional row in the new Org.
  Phase 0 made this safe.
- Abuse controls v1: Clerk email verify + Clerk bot-protection on
  `<SignUp>` + Stripe Fraud Radar + soft rate-limit (3 orgs / 24h
  per Clerk user) + org-name regex denylist.
- Verification: unit tests; Playwright E2E from cold visit through
  Stripe test card → `/admin`.
- **Gate:** Both funnels converge cleanly on Phase 5.

### Phase 7 — Customer portal + `/admin/billing`

- `(admin)/billing/page.tsx`: plan, status, trial end / renewal date,
  seat / quota usage. Reuses queries lifted from `(super)/orgs/[orgId]`
  via `packages/db/src/billing.ts`.
- "Manage billing" button (billing-owner-only) → server action creates
  Stripe Billing Portal session, 303-redirects.
- Trial-ending banner when `trial_end - now() < 3d &&
  subscription_status === Trialing`.
- Verification: portal cancel triggers webhook → Org Suspended; existing
  suspended-gate E2E still passes.
- **Gate:** OrgAdmin self-serve cancel works end-to-end.

### Phase 8 — Grandfather migration + roadmap update

- Confirm Phase 1 backfill ran in production.
- Cutover SQL identical to Phase 1.
- `requireOrgContext` + AI gateway: `Internal` orgs bypass billing
  checks (their `quota_daily` / `quota_monthly` stay populated).
- Update `CLAUDE.md` "What's IN MVP v1" / "What's OUT" with pointers to
  ADR-0017 + ADR-0018.
- Update `docs/BRIEF.md` §13 to reflect that Stripe self-serve is now
  v1.
- Verification: tenancy fuzzer + suspended-gate + new billing E2E all
  green; an `Internal`-plan Org with no Stripe customer renders the
  dashboard normally.

## Tenant isolation impact

- `Plan` is global like `Test` — `withSuperAdminContext` only. **MUST NOT**
  be added to `TENANT_SCOPED_MODELS`. Fuzzer in
  `packages/db/src/tenancy.test.ts` enforces this.
- `Organization` is global; new billing columns sit there.
  `requireOrgContext` restricts to the caller's *active* Org (multi-org-
  aware after Phase 0).
- The multi-org schema change in Phase 0 is the most isolation-sensitive
  step. Fuzzer extension is mandatory: two orgs sharing an email, sign
  in as one, assert zero leakage. Every existing email-keyed query in
  `admin-invite.ts`, `clerk-sync.ts`, `profile.ts` is audited and updated
  to be `(email, org_id)`-keyed.
- Webhook: Org lookup is **always** by `stripe_customer_id` (unique index
  from Phase 1); `metadata.org_id` is a secondary cross-check, never the
  primary key. Webhook rejects mismatches.
- Self-serve `selfServeProvisionOrg`: new `Organization` + `User` rows
  written inside a single Prisma transaction; Clerk-side creation is
  best-effort with the same "DB row exists → Clerk attempt → roll back
  DB on hard fail" pattern as `admin-invite.ts`.
- ActivityLog: super-level rows under `SYSTEM_ORG_ID`; org-level rows
  under the customer org. Same as the existing rule.

## AI cost impact

**Zero direct AI calls.** Plans drive `Organization.quota_daily` /
`quota_monthly` via webhook write-through, so the existing
`packages/ai/src/gateway.ts` enforcement path is unchanged.

## Brand impact

- `/pricing`, `/signup-org`, `/onboarding/plan` all follow the hero /
  section / CTA rhythm. No new tokens. Rubik / brand-red / brand-black
  only.
- Clerk `<SignUp>` and `<OrganizationSwitcher>` themed via the existing
  `clerkAppearance` map. Confirmed against `packages/ui/src/tokens.css`.
- Stripe Checkout + Portal are Stripe-hosted; we set `branding.logo` +
  `branding.primary_color` on the Stripe account so the handoff is
  smooth. Acceptable trade-off, documented in ADR-0017.

## Environment

Sandbox keys present in `packages/db/.env`:

- `STRIPE_PUBLISHABLE_KEY_SANDBOX` — used by client `<Stripe>` for
  Checkout button mounting (if we go embedded; v1 is hosted-redirect so
  this may not be needed).
- `STRIPE_SECRET_KEY_SANDBOX` — used by `apps/web/lib/billing/
  stripe-client.ts`.

Phase 2 also needs (will document in CLAUDE.md and add to `.env.example`):

- `STRIPE_WEBHOOK_SIGNING_SECRET` — set by `stripe listen` in dev, by
  Stripe dashboard in prod.

The codebase already prefers a single `packages/db/.env` for service
credentials (see CLAUDE.md "Clerk env vars" table). We'll follow the
same convention. The `_SANDBOX` suffix on the keys is unusual — Phase 2
will read whichever of `STRIPE_SECRET_KEY` / `STRIPE_SECRET_KEY_SANDBOX`
is set, preferring the unsuffixed name in production.

## Open questions

- **P1 — Annual billing toggle.** Schema leaves room
  (`stripe_price_id_yearly?`); UI in a follow-up phase.
- **P1 — Mid-cycle plan changes from `/admin/billing`** vs Stripe portal
  only. v1 = portal only.
- **P1 — Self-serve Enterprise tier or "Contact sales" link.** v1 = self-
  serve Enterprise at fixed price.
- **P2 — Disposable-email blocking.** Default off in v1; revisit if abuse.
- **P2 — Free-tier abuse.** A bad actor could spin up many Free orgs.
  Mitigated by Clerk email verify + the soft rate-limit; revisit if
  exploited.
- **P2 — Tax (Stripe Tax) on/off?** Off in v1; needs legal sign-off
  before any non-US customer.

## Risks

- **Phase 0 (multi-org) blast radius.** Touches `clerk-sync.ts`,
  `requireOrgContext`, every email-keyed query in `packages/db/src/`.
  Mitigation: feature flag (`MULTI_ORG_ENABLED=1`), comprehensive fuzzer
  extension, single-org rollback by re-adding `@unique` constraints
  (data won't collide pre-Phase 6).
- **Two onboarding funnels diverging.** Risk: `/post-signin` becomes a
  tangle of "invite vs self-serve". Mitigation: store
  `provisioned_via` on Org for analytics only; routing decisions purely
  from `subscription_status`.
- **Self-serve race: tab close between provisioning and Checkout.** Org
  stranded in `PendingPayment`. Mitigation: `/post-signin` always re-
  routes `PendingPayment` to `/onboarding/plan`; daily cleanup archives
  > 30d stranded `PendingPayment` orgs with no Stripe customer.
- **Webhook ordering / replay.** Stripe retries can deliver out of
  order. Mitigation: `StripeEventLog` idempotency + `event.created`
  monotonic check before downgrades.
- **Brand tagline drift.** "Free. Fun. Effective." vs "card required" —
  resolved by P0 #3 (Free plan ships).
- **MVP roadmap deviation.** Pulls Stripe in from Phase 2; adds public
  self-serve. ADR-0017 must call out the displaced Phase-2 items.
- **ADR-0014 D7 partial reversal.** "OrgAdmin home-org membership only"
  — with multi-org, OrgAdmins can hold multiple memberships. ADR-0018
  annotates D7 as superseded for OrgAdmins; Learners still single-org.

## Out-of-session handoff notes

A fresh Claude session should:

1. Re-read `CLAUDE.md`, this plan, ADR-0017, ADR-0018.
2. Run `pnpm install && pnpm db:generate` to sync Prisma types.
3. Check `packages/db/.env` has `STRIPE_SECRET_KEY_SANDBOX` and
   `STRIPE_PUBLISHABLE_KEY_SANDBOX`; `STRIPE_WEBHOOK_SIGNING_SECRET`
   comes from `stripe listen` in dev.
4. Run `pnpm test` and `pnpm --filter web test:e2e` to confirm green
   baseline before starting the next phase.
5. Pick up at the first incomplete phase. Phase 1 is the recommended
   starting point because it's independent of Phase 0 and produces
   immediate, testable value.
