# Plan: Learner Home Dashboard (`/home`)

> Drafted 2026-05-25 via `/plan-feature`. Phase-wise, gated. Resume from the
> first phase whose verification gate is not yet green.

## Goal (one paragraph)

Give the learner a real landing surface after sign-in instead of dropping
them on the Writing picker. `/home` is a single dashboard that (a) greets
them, (b) shows daily quota, (c) lets them resume any in-progress attempt
or mock with one click, (d) shows the four sections + Full Mock as
equal-weight cards with their latest and best band per section, and
(e) lists their last ~10 graded attempts with a link into `/results/[id]`.
This matches the spec line in `docs/BRIEF.md` §5.2 ("Lands on dashboard
showing: recent activity, recommended next test, band score trend") that
has been outstanding since v1 scaffolding.

## Decisions captured during interview

- Landing scope: **dedicated `/home` dashboard**.
- Progress signals: **latest band per section + recent attempts list +
  best band per section + daily quota remaining**.
- Resume behaviour: **"Resume" card at the top** when an InProgress
  Attempt or MockSession exists. Mock takes precedence over standalone.
- Full Mock prominence: **equal hero CTA alongside the four section
  cards**.

## Scope

### IN

- New `/home` route inside the `(learner)` group.
- New read-only data helper `getLearnerDashboard(ctx)` in `packages/db/src/`
  returning all dashboard data in one trip (tenant-scoped via `withOrg`).
- Post-signin trampoline (`apps/web/app/post-signin/page.tsx`) routes
  Learners to `/home`.
- `(learner)/layout.tsx` logo + dev-login return path point at `/home`.
- New components: `DashboardHero` (greeting + quota strip), `ResumeCard`,
  `SectionStatCard` ×4 + `MockStatCard`, `RecentAttemptsList`.
- Empty states for "no attempts yet", "no in-progress", "quota = 0".
- Vitest for the data helper (tenancy + shape).
- Playwright happy-path E2E (Learner signs in → lands on `/home` → sees
  their sections + can click into one).
- ADR-0015 documenting the routing change.

### OUT

- Trend sparklines (deferred).
- Skill-band drilldowns per criterion (live on `/results/[id]`).
- Recommended-next-test logic (brief mentions it, but ranking deserves its
  own ADR; for v1 we just list approved tests on the section pickers).
- Dashboard for OrgAdmin / SuperAdmin — they keep `/admin`, `/orgs`.
- Notifications / unread badges.
- Per-section "you have N approved tasks left" counters.

## Affected layers

- [x] **DB schema** — none. All needed fields already exist on `Attempt`,
      `Grade`, `MockSession`, `QuotaUsage`, `Organization`.
- [x] **API / Server Actions** — no new actions. Page is server-rendered,
      reads only.
- [x] **UI** — new `/home` route + 5 new presentational components in
      `apps/web/components/`.
- [ ] **AI gateway** — no AI calls; dashboard is read-only.
- [ ] **Background jobs** — none.
- [x] **Tests** — Vitest for `getLearnerDashboard` (tenancy fuzzer-style);
      Playwright for the happy path.
- [x] **Docs** — ADR-0015 + a one-line update in `CLAUDE.md` Auth section
      (the "lands on `/practice/writing`" claim becomes `/home`).

## Phases (each with verification gate)

### Phase 1 — Data layer

- **Tasks**
  - Add `packages/db/src/learner-dashboard.ts` exporting
    `getLearnerDashboard(ctx): Promise<LearnerDashboardData>`. Shape
    (single function, one round trip via `Promise.all` of scoped queries):

    ```ts
    {
      user: { firstName, ielts_track, org: { name, quota_daily } },
      quotaToday: { used: number, limit: number },
      resume: {
        attempt?: { id, section, started_at, test_difficulty },
        mockSession?: { id, started_at, currentSection },
      },
      perSection: Record<Section, {
        latestBand: number | null,
        latestAt: Date | null,
        bestBand: number | null,
        attemptsCount: number,
        latestAttemptId: string | null,
      }>,
      recent: Array<{
        id, section, submitted_at, status,
        band_overall: number | null,
      }>,
    }
    ```

  - All queries use `withOrg(ctx)` and filter `user_id: ctx.user_id`.
    `Organization` is fetched via
    `withOrg(ctx).organization.findUniqueOrThrow({ where: { id: ctx.org_id } })`
    for `quota_daily` + `name`.
  - Export from `packages/db/src/index.ts`.

- **Verification**
  - `packages/db/src/learner-dashboard.test.ts`: two-org fuzzer — seed
    Org A learner with attempts + grades + an in-progress attempt + a
    mock; seed Org B learner with their own data; assert
    `getLearnerDashboard(ctxA)` only returns Org A's rows; assert
    per-section aggregates (latest = most recent submitted_at, best =
    max band), recent list ordering, and quota math.
  - `pnpm test` green.

- **Gate**: helper passes tenancy + shape tests. No Phase 2 UI work
  starts until this lands.

### Phase 2 — Page skeleton + routing flip

- **Tasks**
  - Create `apps/web/app/(learner)/home/page.tsx` (server component).
    Reads ctx via `requireOrgContext`, calls `getLearnerDashboard(ctx)`,
    renders:
    - `RoleGreeting` (existing component, learner tagline).
    - `DashboardHero` placeholder with the four `SectionStatCard`s + one
      `MockStatCard` in a responsive grid
      (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`). Each card links to
      `/practice/{section}` or `/mock`.
    - Empty-state copy when `attemptsCount === 0` for a section: "Your
      first task is waiting →".
  - Update `apps/web/app/post-signin/page.tsx`: change the Learner branch
    from `/practice/writing` to `/home`.
  - Update `apps/web/app/(learner)/layout.tsx`: change the header
    `<Link href="/practice/writing">` to `/home`; change
    `devLoginReturnPath("/practice/writing")` to `/home`.
  - Build the cards on the brand rhythm: white surfaces on
    `bg-brand-grey-50`, `font-heading font-bold` titles, single red CTA
    pill per card, `focus-visible:ring-brand-red`. **No new colors, no
    new fonts.**

- **Verification**
  - `pnpm typecheck && pnpm lint && pnpm build` green.
  - Manual: `/dev/login` as a seeded Learner → land on `/home` → see four
    section cards + mock + sensible empty states. Click each card →
    arrives at the correct existing picker.

- **Gate**: routing flip is reversible (one-line revert in
  `post-signin/page.tsx`); UI cards render without throwing on a fresh
  learner with zero attempts.

### Phase 3 — Resume card + quota strip + recent attempts

- **Tasks**
  - `ResumeCard` — only renders if `resume.attempt` or
    `resume.mockSession` is set. Mock takes precedence. Single primary
    CTA "Continue", deep-links to:
    - `/mock/[mockId]` for an in-progress mock, or
    - `/practice/{section}/[attemptId]` for a standalone in-progress
      attempt.
    - Small secondary text: "Started {relativeTime}".
  - `QuotaStrip` — small horizontal bar inside `DashboardHero`:
    "X of Y AI calls used today." If `quota_daily === 0` (orgs default
    to 0 until provisioned), hide the strip rather than confuse the
    learner with "0 of 0".
  - `RecentAttemptsList` — table with columns: Section · Band · When ·
    Link. Use `<Link>` to `/results/[id]` for Graded rows; Submitted
    rows show "Grading…" pill; InProgress rows link back to the section
    route. Empty state: "No history yet — pick a section above to drill."

- **Verification**
  - Manual: start a Writing attempt, leave it, return to `/home` → see
    Resume card. Submit + grade → it disappears from Resume and appears
    in Recent with the band. Repeat for mock.
  - Unit: extend `learner-dashboard.test.ts` with cases for
    (a) most-recent InProgress wins when both exist, (b) mock takes
    precedence over standalone, (c) recent list excludes other users.

- **Gate**: all three components render gracefully in every
  empty/partial state.

### Phase 4 — A11y, E2E, docs

- **Tasks**
  - Run axe on `/home` via Playwright (mirror pattern from
    `tests/e2e/sign-in-a11y.spec.ts`). Fix violations.
  - New Playwright spec `tests/e2e/learner-home.spec.ts`: sign in as the
    seeded Learner → assert greeting, section card grid, mock card,
    click into Writing → arrive at picker.
  - Write `docs/adr/0015-learner-home-dashboard.md`: routing change,
    why a separate route over enriching `/practice/writing`, tradeoffs
    around the single-query helper, deferred items.
  - Update `CLAUDE.md` Auth section: `/post-signin` description now
    says routes to `/home` (not `/practice/writing`) for Learners.

- **Verification**
  - `pnpm --filter web test:e2e` green, including the new spec and a11y.
  - `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` all green.
  - `/audit-tenancy` shows no findings on the changed paths.

- **Gate**: everything ships in one PR.

## Tenant isolation impact

Yes — `getLearnerDashboard` reads from `User`, `Attempt`, `Grade`,
`MockSession`, `QuotaUsage`, and `Organization`. **Every query goes
through `withOrg(ctx)`**, including the `Organization` lookup (which
`withOrg` passes through for global tables, so we use `ctx.org_id` from
the session — never from the request body/query). `Test` and `Question`
reads are global by design (shared pool); we never join from
`Attempt → Test` in a way that leaks another org's attempt. The
fuzzer-style test in Phase 1 is the contract that proves this.

Critically: the dashboard never reads `user_id` from the URL or body —
only from `ctx.user_id` derived server-side.

## AI cost impact

**Zero.** The dashboard makes no LLM / TTS / STT / realtime calls. It
only *reads* `QuotaUsage` to display the gauge. No new `purpose` is
added to the gateway allowlist.

## Brand impact

All new surfaces follow `.claude/skills/brand-system/SKILL.md`:

- Tokens only (`bg-brand-grey-50`, `bg-brand-white`, `text-brand-black`,
  `bg-brand-red`).
- Rubik only — `font-display italic font-bold` for hero,
  `font-heading font-bold` for card titles, `font-body font-medium` for
  body.
- One red CTA per card; secondary actions are text links or outlined.
- Card grid breakpoints follow the brand rhythm (white cards on grey
  surface, generous spacing).
- No new tokens introduced.

## Open questions

- **P1** — Should the "Resume" card offer a "Discard" affordance for
  stale InProgress rows? Default: no in v1; cleanup belongs on the
  attempt/server side, not the dashboard.
- **P2** — Tie-breaker when multiple InProgress attempts exist across
  sections. Proposed: most recently `started_at` wins. Mock always beats
  standalone.
- **P2** — Hide "best band" when there's only one graded attempt for
  that section? Proposed: always show both; redundancy at attempt #1 is
  fine and disappears immediately.

## Risks

- **Query cost on every login.** Mitigated by existing indexes
  (`Attempt @@index([org_id, user_id])`, `[org_id, submitted_at]`;
  `QuotaUsage @@unique([user_id, date])`). Helper batches via
  `Promise.all`; expected ≤ 6 small queries.
- **Routing flip leaves stale links.** Search repo before merge for any
  other `/practice/writing` hardcodes. Rollback is a one-line revert in
  `post-signin/page.tsx`.
- **Empty-state confusion.** Each `SectionStatCard` shows a "Start your
  first {section} task →" CTA when `attemptsCount === 0`, so the page is
  never literally blank.
- **Quota strip showing 0/0 for unprovisioned orgs.** Hide it rather
  than show "0 of 0".
- **Mock-takes-precedence rule could surprise.** Mitigation: Resume card
  explicitly says "Full Mock in progress" so the user knows which one
  will resume.

## Progress log

- 2026-05-25 — Plan written and approved. Beginning Phase 1.
- 2026-05-25 — Phases 1–4 shipped end-to-end (unit + E2E + a11y + ADR-0015 + CLAUDE.md). All gates green.
- 2026-05-25 — Redesign per "bland and busy" feedback: sections moved
  to inline header nav (`learner-nav.tsx`); body now uses flat stat
  tiles + subtle resume strip + quiet recent list + one-line quota.
  Replaced `SectionStatCard`, `MockStatCard`, `ResumeCard`,
  `QuotaStrip`, `RecentAttemptsList` (deleted) with
  `SectionStatTile`, `ResumeStrip`, `RecentAttempts` and the new
  `LearnerNav`. ADR-0015 D7 captures the rationale. 12 E2E green
  (5 home + a11y).
