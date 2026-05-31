# ADR 0015 — Learner home dashboard

- Date: 2026-05-25
- Status: Accepted

## Context

Until now, Learners landed on `/practice/writing` after sign-in. That
route was the Writing section picker doing double duty as a home page:
no cross-section nav, no progress summary, no way to resume an
in-progress attempt. `docs/BRIEF.md` §5.2 already specified that
Learners should "Land on dashboard showing: recent activity, recommended
next test, band score trend" — the dashboard had simply never been
built.

The implementation plan is `docs/plans/learner-home-dashboard.md`. This
ADR captures the decisions that emerged while building it.

## Decision

### D1 — Dedicated `/home` route, not an enriched `/practice/writing`

We add a new route `apps/web/app/(learner)/home/page.tsx` and route the
post-signin trampoline (`apps/web/app/post-signin/page.tsx`) Learner
branch there. The section pickers keep their existing URLs and
responsibilities.

Alternative considered: enrich `/practice/writing` with dashboard
widgets. Rejected because:

- The "home page" and the "Writing section picker" are different jobs
  with different empty states, different CTAs, and (eventually)
  different cache strategies.
- A separate route lets us roll back the routing flip with a one-line
  revert in `post-signin/page.tsx` if anything regresses.
- The brand rhythm reads cleaner with a dashboard whose hero is "Your
  IELTS dashboard." than with a Writing picker whose hero is "Pick a
  task." topped by an unrelated dashboard strip.

### D2 — One data helper, one round trip

All dashboard reads live in `packages/db/src/learner-dashboard.ts` as
`getLearnerDashboard(ctx)`. The helper batches eight Prisma queries via
`Promise.all` and shapes the result into a single
`LearnerDashboardData` object the page consumes verbatim.

Trade-offs:

- One DB round trip on every Learner sign-in, paid through existing
  indexes (`Attempt @@index([org_id, user_id])`,
  `[org_id, submitted_at]`, `QuotaUsage @@unique([user_id, date])`).
- Aggregation is done in JS, not SQL. With v1's expected volumes
  (≤ a few hundred attempts per learner over the product's lifetime)
  this is fine; if it ever stops being fine, we'd switch to a
  `prisma.attempt.groupBy` for per-section bands without changing the
  page contract.
- Two separate read passes for graded vs ungraded attempts. The
  alternative (one read, filter in JS) is marginally cheaper but harder
  to reason about — separate filters make the test cases exact.

### D3 — Tenant isolation via `withOrg(ctx)` exclusively

Every query in `getLearnerDashboard` runs through `withOrg(ctx)`,
including the `Organization` lookup (which the proxy passes through for
global tables). `user_id` is **always** `ctx.user_id` — never sourced
from URL, body, query string, or session claim other than the one
derived server-side by `requireOrgContext`. The
`learner-dashboard.test.ts` two-org fuzzer is the contract: dashboard A
must never see any row, count, or aggregate belonging to org B, even
when the test seeds bands of 9.0 in org B that would dominate org A's
"best".

### D4 — Mock takes precedence over standalone attempts in the Resume card

When both an in-progress `MockSession` and a standalone in-progress
`Attempt` exist, the Resume card surfaces the mock. Reasons:

- A mock is a multi-section commitment with section ordering and exam
  timing constraints; resuming the wrong thing wastes more of the
  learner's time.
- The standalone attempt is still reachable via the relevant section
  card's normal flow, so we don't strand it.
- The Resume card uses the prefix "Full Mock in progress" so the
  learner knows which artefact will resume.

The data helper returns both branches; the precedence rule lives in the
`ResumeCard` component so it can be flipped or extended (e.g. an
explicit "Resume something else" link) without a schema or query change.

### D5 — `currentSection` for a mock is the first non-graded section in
sit order, not "most recent attempt"

The mock orchestrator uses sit order
(`Listening → Reading → Writing → Speaking`, see ADR 0008 D4). The
dashboard mirrors that derivation rather than picking "the section whose
attempt was last touched". This keeps the Resume card's hint
("Continue at Reading.") consistent with what the `/mock/[mockId]`
orchestrator will actually route the learner to on click. The logic is
duplicated from `apps/web/lib/mock/actions.ts` into
`packages/db/src/learner-dashboard.ts` rather than imported, to avoid a
cross-package dependency from `@elc/db` back into the app. If we change
one we change both — comment in both files notes this.

### D6 — Quota strip hidden when `quota_daily === 0`

Orgs default to `quota_daily = 0` until a SuperAdmin provisions a real
limit. Showing "0 of 0 AI calls used today" would alarm a Learner who
hasn't done anything wrong. The strip simply doesn't render in that
state. Once a quota is set, the strip appears and tracks against it.

### D7 — Sections live in the header nav, not as cards

The first build of `/home` rendered the four sections (+ Full Mock) as
equal-weight cards in the body. On review that read as "bland and
busy": five red-and-black cards competing for attention before the
learner had even seen their progress.

We moved the sections onto an inline nav strip on the existing black
header (`apps/web/components/learner-nav.tsx`, injected by
`(learner)/layout.tsx`). The body now opens with the greeting, a flat
4-up "Where you are" row of latest bands, a subtle Resume strip when
applicable, and a quiet "Recently" list. Quota dropped to a single
trailing line.

The learner header also shows the user type (`Learner`) beside the logo
to match the role cue used by admin chrome. The practice nav follows the
SuperAdmin header pattern: logo/type on the left, then a simple
right-aligned menu group (`Reading`, `Listening`, `Writing`, `Speaking`,
`Mock`, `Profile`, `Sign out`). We previously tried centering the
practice menu, but the result looked crowded and less consistent than
the clean admin chrome.

Reasons:

- Sections are navigation, not content. Putting them in the header
  matches the user's mental model (and stays one click away from any
  practice or result page, not just `/home`).
- The dashboard body now has one job: tell the learner where they are
  and what to do next. No card chrome, no second hero.
- Active state on the nav is a thin red underline — keeps the brand
  red as a single-pixel accent instead of five card-sized borders.

On viewports under `md`, the nav is hidden; the "Where you are" tiles
are themselves links into each section, so the home page doubles as
the section menu on mobile.

### D8 — Deferred for now

The plan called these out as out-of-scope for v1 and we held that line
across both the first build and the redesign:

- **Trend sparklines per section.** Real visual progress is great; the
  per-section "latest" + "best" pair is the v1 substitute.
- **Recommended-next-test ranking.** The brief mentions it but it
  deserves its own ADR (the ranking rules touch difficulty, recency,
  the learner's last band, and the pool of approved content). For v1
  the section pickers continue to list approved tests in their existing
  order.
- **Discard affordance for stale `InProgress` rows.** Cleanup belongs
  on the attempt/server side, not the dashboard.
- **Per-criterion drilldown.** Already lives on `/results/[id]`; no
  reason to duplicate on `/home`.

## Consequences

### Good

- Learners now have a real landing surface with progress at a glance.
- The brief's §5.2 dashboard requirement is satisfied.
- The post-signin trampoline now routes by role consistently (SuperAdmin
  → `/orgs`, OrgAdmin → `/admin`, Learner → `/home`).
- The Resume card lifts a real UX paper cut: previously, a learner who
  paused a Writing attempt had to remember to navigate back to it.
- All dashboard reads go through `withOrg(ctx)` and are covered by a
  fuzzer-style two-org test; we did not regress tenant isolation.

### Bad

- One extra DB round trip on every Learner page load (eight cheap
  queries via `Promise.all`). Acceptable on the existing indexes.
- The `MOCK_SECTION_ORDER` constant is duplicated between
  `packages/db/src/learner-dashboard.ts` and
  `apps/web/lib/mock/constants.ts`. Comments in both files warn that
  they must change together.
- The routing flip touches four files
  (`post-signin/page.tsx`, `(learner)/layout.tsx`, `dev/login/page.tsx`,
  `dev/login/actions.ts`). Anyone wiring a new "post-signin home for
  Learners" surface needs to remember the layout's logo link too.
- We have not yet built a manual `verify` walkthrough; the Playwright
  spec (`tests/e2e/learner-home.spec.ts`) is the only end-to-end check.

## Follow-ups

- Sparkline per section (D7).
- Recommended-next-test ranking (D7); needs its own ADR.
- "Discard stale InProgress" cleanup job (D7) — server-side, not
  dashboard.
- Update `docs/BRIEF.md` §5.2 to point to this ADR instead of leaving
  the dashboard line as an unbuilt promise.
