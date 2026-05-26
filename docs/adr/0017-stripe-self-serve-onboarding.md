# ADR 0017 — Stripe self-serve onboarding + tiered subscriptions

- Date: 2026-05-26
- Status: Proposed (Phase 1 in progress)

## Context

`docs/BRIEF.md` §12 lists "payment processing UI" as explicitly OUT of
MVP v1, and §13 places "self-service billing portal (Stripe)" on the
Phase 2 roadmap. ADR-0013 shipped the OrgAdmin dashboard without any
billing surface; ADR-0014 wired Clerk auth but kept Org creation as a
SuperAdmin-only act. We currently have no concept of a "plan", no
public sign-up funnel, and no way for a customer to start paying.

We are pulling that work forward and going further:

1. A public **self-serve funnel** at `/pricing` → `/signup-org` that any
   visitor can use to spin up an Org, pick a plan, and start a 14-day
   trial against a real Stripe Customer.
2. The existing **SuperAdmin invite path** for hand-sold orgs, with the
   same plan-selection wizard and Stripe Checkout once the OrgAdmin
   signs in.
3. A SuperAdmin-managed **Plan catalogue** (Free / Starter / Pro /
   Enterprise) where the DB is the source of truth and the Stripe
   Product + Price are derived from it.

The implementation plan is `docs/plans/stripe-self-serve-onboarding.md`.
ADR-0018 records the multi-org user-membership schema change that self-
serve depends on.

## Decision

### D1 — Pull Stripe self-serve forward into MVP v1

`docs/BRIEF.md` §13 had Stripe as Phase 2. We are bringing it into v1
because:

- Without billing, there is no way to onboard a paying customer; every
  new org requires SuperAdmin intervention, which doesn't scale past the
  first handful of hand-sold deals.
- The brand tagline ("Skills That Open Doorways — Free. Fun. Effective.")
  has been live since the marketing scaffold; a paid-only product
  contradicts it.
- Stripe Checkout + hosted Portal is a small surface to add; the cost is
  in the surrounding plumbing (plan catalogue, onboarding wizard,
  webhook idempotency) and that plumbing is reusable across funnels.

Trade-off: this displaces some Phase-2 items on `docs/BRIEF.md` §13.
SSO, custom branding, cohort analytics, and the mobile shell are pushed
further out. `docs/BRIEF.md` §12 and §13 will be updated in Phase 8 of
the implementation plan to reflect the new boundary; for now the brief
remains as-is and this ADR is the single source of "we changed our
minds".

### D2 — Two parallel funnels share one wizard

Self-serve and SuperAdmin-invite both converge on `/onboarding/plan`
once an `Organization` row exists in `subscription_status:
PendingPayment`. The funnels differ only in *how* that row gets
created:

- **SuperAdmin invite:** SuperAdmin creates the Org + invites the
  OrgAdmin (`packages/db/src/admin-invite-orgadmin.ts`). Plan is set at
  org-create time. The invitee accepts via Clerk, lands on
  `/post-signin`, gets routed to `/onboarding/plan` because the Org is
  still `PendingPayment`.
- **Self-serve:** Visitor hits `/pricing`, clicks a plan CTA, signs up
  via Clerk inline at `/signup-org`, fills in org name at
  `/signup-org/continue`. The server action `selfServeProvisionOrg`
  creates the Clerk Org + DB Organization + DB User + Clerk membership
  in a single transactional path, then redirects to
  `/onboarding/plan?preselect={slug}`.

`/post-signin` makes routing decisions purely from
`subscription_status`. We track the funnel origin via
`Organization.provisioned_via` (`invite` | `self_serve` | `seeded`) for
analytics, not for routing — the two should never diverge.

### D3 — `OrgStatus` and `subscription_status` are separate columns

`OrgStatus { Active, Suspended, Archived }` keeps its current
moderation/lifecycle semantics. A new
`subscription_status { Trialing, Active, PastDue, Canceled,
Incomplete, Internal, PendingPayment }` enum holds billing state.

The two are coupled at two points:

- Stripe webhook receives `customer.subscription.deleted` →
  `subscription_status = Canceled` AND `OrgStatus = Suspended`. The
  existing Suspended-org gate (`OrgSuspendedError` in
  `apps/web/lib/auth/context.ts`) then handles the UX automatically.
- SuperAdmin can manually `OrgStatus → Suspended` for non-billing
  reasons (T&C violation, fraud). `subscription_status` is unchanged in
  that path so the audit trail distinguishes "billing-driven suspension"
  from "moderation-driven suspension".

Rejected alternative: a single `OrgStatus` enum with `PendingPayment`,
`PastDue`, etc. mixed in. That conflated billing state with moderation
state and made the "manually suspended for T&C" case ambiguous.

### D4 — Free plan ships in v1 to honour the tagline

The brand tagline is "Free. Fun. Effective." A card-required-only
catalogue contradicts the first word. v1 ships a `Free` plan
alongside Starter / Pro / Enterprise:

- 1 active learner seat
- 50 daily / 300 monthly AI calls per user
- `is_internal: false`, `amount_monthly_usd: 0`
- **No Stripe Product or Price.** `stripe_product_id` stays null.
- Special-cased in `/onboarding/plan`: skip Stripe Checkout, set
  `subscription_status: Internal`, `OrgStatus: Active`, redirect
  straight to `/onboarding/welcome`.

Free orgs are visible in the SuperAdmin console like any other Org.
Abuse vector (one Clerk user → many Free orgs) is mitigated by the
multi-org soft rate-limit in Phase 6 (3 orgs / 24h per Clerk user)
plus Clerk's email verification. Revisit if exploited.

### D5 — Plan catalogue: DB is source of truth, Stripe is mirror

SuperAdmin manages Plans through `(super)/plans/`. On create / update
we idempotently upsert a Stripe Product (keyed on
`metadata.plan_slug`) and a recurring monthly Price. Stripe IDs are
stamped back on the Plan row.

Rationale:

- Product team owns plan **features** (seat_limit, quota_daily,
  quota_monthly, name, description). Those live in the DB and drive
  app behaviour (gateway quotas, seat enforcement).
- Finance / SuperAdmin owns plan **pricing**. We push to Stripe on save
  rather than let Stripe drift; "Re-sync to Stripe" button on the plan
  detail page covers manual recovery.
- `is_internal` plans (and Free) never sync to Stripe — no Product is
  created, no Price exists.

Rejected alternative: Stripe as source of truth with a webhook sync
back to DB. Adds a moving part for no win — SuperAdmin already lives in
our admin console, not Stripe's dashboard.

### D6 — Card-required 14-day trial via Stripe `trial_period_days`

Checkout Sessions set `subscription_data.trial_period_days = 14` (the
default; per-plan override via `Plan.trial_days`). Card is collected up
front. Stripe handles trial-end conversion automatically.

Rationale: matches B2B SaaS norms; aligns intent (we attract serious
prospects, not curiosity churn); Stripe's built-in trial-ending email
covers the "your trial ends in 3 days" comms without us building it.

Rejected alternative: no-card free trial → upgrade later. Lower
friction but adds an "I'm on a trial, no card yet" intermediate state
the schema would have to model, plus an abuse vector. Defer.

### D7 — Stripe Customer lookup, never Stripe metadata

The webhook handler (Phase 4) looks up the Org **only** by our
`stripe_customer_id` column (unique-indexed in Phase 1). Stripe's
`metadata.org_id` on Customer + Subscription is a second-source cross-
check — the handler asserts
`stripe_customer.metadata.org_id === lookup.org_id` and throws on
mismatch.

This follows the `.claude/rules/multi-tenancy.md` "never trust client-
provided IDs" rule even though Stripe is technically a trusted source.
A misconfigured Stripe webhook (wrong account, replayed staging event
in prod) must not be able to mutate an unrelated Org.

### D8 — Webhook idempotency via `StripeEventLog`

A new `StripeEventLog` table records every received `stripe_event_id`
with `received_at` and processing status. Webhook handler:

1. Verify Stripe signature with `STRIPE_WEBHOOK_SIGNING_SECRET`.
2. Insert into `StripeEventLog` (unique constraint on
   `stripe_event_id`). If insert fails (P2002), the event has already
   been processed — return 200 OK with no-op.
3. Otherwise process the event, then mark the row complete.

Plus a monotonic ordering check: before any state downgrade (e.g.
`Active → PastDue`), compare the incoming Stripe `event.created` to
the most recent processed event for the same subscription; ignore
out-of-order downgrades. This mirrors the lesson recorded in
`memory/webhook-ordering-followup.md` from the Clerk-webhook work.

### D9 — Billing-owner OrgAdmin

`Organization.billing_owner_user_id` points at the OrgAdmin User row
that should have Stripe Portal access. Stamped at provisioning time:

- Self-serve: the Clerk user who completed `selfServeProvisionOrg`.
- Invite: the first OrgAdmin invited for the Org.

Other OrgAdmins on the same Org can read `/admin/billing` (plan,
status, renewal date, usage) but the "Manage billing" button is
disabled with a tooltip pointing at the billing-owner's email. v1
does not let SuperAdmin transfer billing ownership through the UI;
the column is mutable directly in the DB if needed (`/orgs/[orgId]`
can surface this in a follow-up).

### D10 — Suspended-gate reuse for Canceled

When a subscription is cancelled or hard-fails, the webhook flips
`OrgStatus → Suspended`. The existing `OrgSuspendedError` path in
`apps/web/lib/auth/context.ts` and the `/suspended` page handle the
UX with no new code. The OrgAdmin can still reach `/sign-out` and the
SuperAdmin console (their cross-org powers come from the DB role,
not from Org membership).

`PendingPayment` is **distinct** from `Suspended`: the layout
middleware permits only `/onboarding/*` and `/sign-out` when the
caller's Org is `PendingPayment`, but does NOT throw
`OrgSuspendedError`. Treating the two states identically would have
trapped invited OrgAdmins in `/suspended` before they ever saw the
plan picker.

## Consequences

### Good

- The product is now sellable. A prospect can self-serve from cold visit
  to active subscription in a single sitting.
- SuperAdmin's hand-sold path is unchanged in shape but gains automated
  billing — no more out-of-band invoicing.
- Plan catalogue centralises seat / quota tuning in one place; the AI-
  gateway hot path is unaffected (still reads `Organization.quota_*`).
- Webhook idempotency table is reusable for any future external-webhook
  source (PostHog, Sentry, etc.).
- Free plan honours the brand tagline without rewriting the marketing
  copy.

### Bad

- Roadmap deviation displaces some Phase-2 items on `docs/BRIEF.md` §13.
  Customers who would have asked for SSO or custom branding before
  billing now have to wait.
- Stripe Checkout + Portal are Stripe-branded surfaces. We control
  `branding.logo` + `branding.primary_color` but not the page layout.
  Brand purity takes a small hit.
- Webhook reliability is now a production dependency. We rely on Stripe
  Smart Retries + our idempotency table; a sustained outage of our
  webhook endpoint can leave Orgs stuck in `Incomplete` for hours.
- Card-required trial may convert worse than no-card trial; we'll watch
  signup-to-trial-start conversion in PostHog and revisit if it bites.
- The Free plan invites abuse (multiple throwaway accounts). The Clerk-
  email-verify + soft rate-limit defence is best-effort, not airtight.

## Follow-ups

- ADR-0018 to land alongside this one — multi-org user membership.
- Update `docs/BRIEF.md` §12 / §13 once Phase 8 ships.
- Update `CLAUDE.md` with the new "Billing & plans" section and the
  PendingPayment branch in `/post-signin`.
- Annual billing toggle (`stripe_price_id_yearly?`) — schema leaves
  room, UI deferred.
- Mid-cycle plan-change UI from `/admin/billing` — defer to Stripe
  portal in v1; revisit if support tickets pile up.
- Self-serve Enterprise gating ("Contact sales" instead of Checkout) —
  consider once we have real Enterprise prospects.
- Stripe Tax / VAT for non-US customers — needs legal sign-off; defer.
- Daily cleanup job for stranded `PendingPayment` orgs older than 30
  days with no Stripe customer — needs a background-job primitive.
- Visual QA on Stripe Checkout / Portal branding once `branding.logo`
  is uploaded.
