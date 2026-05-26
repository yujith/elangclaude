# Plan: Complete Login Experience (Clerk seed creds + invitations + brand polish + role-aware landings)

> **Status:** Ready for execution. Scoped 2026-05-22, open questions resolved 2026-05-24.
> **Execution mode:** Phase-by-phase. Stop at every verification gate; do not auto-advance.

## Resolved decisions (do not re-litigate)

| # | Decision | Rationale |
|---|---|---|
| 1 | Create Clerk Organizations for the two seeded demo orgs (`Demo English Academy`, `Migration Pathways Co`) and Clerk org-memberships for the SuperAdmin + the two seeded OrgAdmins. | Keeps `<OrganizationSwitcher>` sane, avoids forcing OrgAdmins through `/create-org` on first login. |
| 2 | **Skip Clerk org-membership for Learners.** | `requireOrgContext` reads `org_id` from our DB User row, never from Clerk's `auth().orgId`. Mirroring Learner membership to Clerk adds drift surface (e.g. a soft-deleted Learner stays "in" the Clerk org) with zero functional gain. Documented as an explicit asymmetry in `clerk-seed.ts` + the CLAUDE.md Auth section. |
| 3 | Default seed password = `elanguagecenter2026!`. Override via env `SEED_DEFAULT_PASSWORD`. Validate length ≥ 8 and reject Clerk's leaked-password list before any Clerk write so failures surface early. | Convenient for dev/demo. Override leaves staging free to use a stronger value without code changes. |
| 4 | Clerk email-template branding is a one-time **dashboard** task, not a code task. Document in `SETUP.md` under a "Manual Clerk dashboard config" section alongside webhook endpoint URL + allowed redirect URLs. | Out of code scope. Tracked in project memory `clerk-dashboard-manual-config`. |
| 5 | Bulk-invite rate limiting: catch Clerk 429 → backoff 2s → retry once → on second failure, mark the row `failed: clerk_rate_limited` and surface in `CsvInviteResult.failed`. No background queue. | Free Clerk tier ≈ 100/hour; current `CSV_ROW_CAP = 500`. `inviteLearnerForOrg` is already idempotent so the OrgAdmin can re-run for failed rows. YAGNI on a queue until we either move to paid Clerk or see real customer impact. |

## Goal

Deliver a polished, end-to-end login experience layered on top of the existing Clerk wiring. Every seeded user from `pnpm db:seed` (1 SuperAdmin + 2 demo OrgAdmins + 4 demo Learners) can sign in immediately with the dev password `elanguagecenter2026!` — no extra setup. Real, newly-invited users go through Clerk's recommended invitation flow (branded email → user sets their own password or chooses OAuth) instead of any shared default. Sign-in/sign-up surfaces are brand-aligned, each role lands on a personalised greeting, and a Playwright E2E proves all three logins keep working.

## Scope

**IN**
- Seed-time creation of Clerk Users + Clerk Organizations + memberships for all DB-seeded rows (with the asymmetry from decision #2), with `elanguagecenter2026!` (dev only, env-gated).
- Clerk Invitations API wired into `inviteLearnerForOrg` (and the CSV bulk path).
- Branded redesign of `/sign-in` and `/sign-up` (hero panel + Clerk widget) plus brand sweep of `/post-signin` and `/no-access`.
- Role-aware welcome greeting on `/orgs` (SuperAdmin), `/admin` (OrgAdmin), and the Learner home.
- Playwright E2E covering one sign-in per role using `@clerk/testing`.
- Documentation: SETUP.md, packages/db/README.md, CLAUDE.md, ADR-0013.

**OUT**
- OAuth / SSO (Brief Phase 2).
- MFA enforcement.
- Per-org configurable initial password.
- Production-grade Clerk email-template branding (dashboard-side, not code — see decision #4).
- Self-serve OrgAdmin invitation surface — Phase 2 of the broader product; this plan only wires the existing `inviteLearnerForOrg` path.
- Replacing the `/dev/login` cookie escape hatch.
- Fixing the `webhook-ordering-followup` bug — separate follow-up tracked in project memory.

## Affected layers

- [ ] **DB schema** — none. `clerk_user_id` / `clerk_org_id` columns already exist (migration `20260522120000_clerk_id_mapping`).
- [x] **API / Server Actions** — `packages/db/src/admin-invite.ts` extends to call Clerk Invitations; new `packages/db/src/clerk-seed.ts` for the seed-time Clerk creation, invoked from `packages/db/prisma/seed.ts`.
- [x] **UI** — `apps/web/app/sign-in/[[...sign-in]]/page.tsx`, `apps/web/app/sign-up/[[...sign-up]]/page.tsx`, `/post-signin/page.tsx`, `/no-access/page.tsx`, `(super)/orgs` landing, `(admin)/admin` landing, `(learner)` home.
- [ ] **AI gateway** — none.
- [ ] **Background jobs** — none (Clerk sends invitation emails).
- [x] **Tests** — `packages/db/src/clerk-seed.test.ts`, `packages/db/src/admin-invite.test.ts` (extend), Playwright `apps/web/tests/e2e/role-login.spec.ts`.
- [x] **Docs** — `SETUP.md`, `packages/db/README.md`, `CLAUDE.md` Auth section, `docs/adr/0013-clerk-seed-and-invitations.md`.

## Phases

### Phase 1 — Seeded credentials for existing users

**Read first:** `.claude/skills/multi-tenant-prisma/SKILL.md`, `.claude/rules/multi-tenancy.md`, the existing `packages/db/prisma/seed.ts` and `packages/db/src/clerk-sync.ts` (the new module must follow the same patterns).

**Tasks**
- Add `@clerk/backend` dependency to `packages/db/package.json` (or a thin wrapper in `apps/web` if the workspace makes that cleaner).
- New `packages/db/src/clerk-seed.ts` exporting `seedClerkIdentities()`:
  - For each seeded `User`: if `clerk_user_id` is null, call `clerkClient.users.createUser({ emailAddress: [email], password, firstName, lastName, skipPasswordChecks: false })`. On `422 form_identifier_exists`, fall back to `users.getUserList({ emailAddress })` and stamp the existing id.
  - For each non-system seeded `Organization`: if `clerk_org_id` is null, call `clerkClient.organizations.createOrganization({ name, createdBy: <super-clerk-id> })` and stamp the returned id.
  - For SuperAdmin + each seeded OrgAdmin: `clerkClient.organizations.createOrganizationMembership({ organizationId, userId, role })` where role is `admin` for OrgAdmin and `admin` for SuperAdmin in their home org. **Do NOT create memberships for Learners** (decision #2).
  - Name split: our schema has a single `name` field; split on the first space — first token → `firstName`, remainder → `lastName`. If no space, use the full name as `firstName` and leave `lastName` empty.
- Refuse to run if `NODE_ENV === "production"` **or** `CLERK_SECRET_KEY` is unset — loud error, `process.exit(1)`.
- Password sourcing: `process.env.SEED_DEFAULT_PASSWORD ?? "elanguagecenter2026!"`. Reject (with a clear message) if length < 8.
- `SEED_SKIP_CLERK=1` short-circuits the whole function for offline dev.
- Wire `seedClerkIdentities()` to run as the final step of `packages/db/prisma/seed.ts` so `pnpm db:seed` covers everything.

**Verification**
- `packages/db/src/clerk-seed.test.ts` with a mocked `clerkClient` covers: fresh create, existing-Clerk-user lazy fetch, prod refusal, missing-secret refusal, weak-password refusal, `SEED_SKIP_CLERK=1` short-circuit, Learner-membership skip.
- Manual: run `pnpm db:seed`. Sign in via `/sign-in` as each of the seeded emails with `elanguagecenter2026!`. SuperAdmin lands on `/orgs`, OrgAdmins on `/admin`, Learners on `/practice/writing`.
- Re-run `pnpm db:seed` — second run is a no-op for Clerk (every user/org already linked).

**Gate (must pass before Phase 2):** All 7 seeded logins succeed manually, seed is idempotent, `pnpm --filter @elc/db test` is green.

---

### Phase 2 — Clerk Invitations for new users

**Read first:** `.claude/skills/multi-tenant-prisma/SKILL.md`, the current `packages/db/src/admin-invite.ts` (full file) and the existing webhook handler at `apps/web/app/api/clerk/webhook/route.ts`.

**Tasks**
- Extend `inviteLearnerForOrg` (single + CSV path): after the DB User row is created, call `clerkClient.invitations.createInvitation({ emailAddress: email, redirectUrl: \`${APP_URL}/post-signin\`, publicMetadata: { org_id: ctx.org_id, role: "Learner" } })`.
- Add a new failure reason to `InviteFailureReason`: `"clerk_rate_limited"`. Surface it in `CsvInviteResult.failed`.
- Failure modes:
  - Clerk `422 duplicate_record` (already invited) → treat as success (idempotent re-invite).
  - Clerk `429` → `await sleep(2000)`, retry once; on second 429 → `clerk_rate_limited`.
  - Clerk 5xx → roll back the DB User row in the same transaction; return `cannot_invite`.
- Webhook side already handles `user.created` → lazy-link by email. Confirm `applyClerkUserUpsert` still works given the lazy-link wins by email and `publicMetadata` isn't read by us yet.
- Document `CLERK_SECRET_KEY` and `APP_URL` as required envs for any code path that calls invites. Throw a helpful error at first invite if they're missing.

**Verification**
- Extend `packages/db/src/admin-invite.test.ts` with mocked `clerkClient.invitations.createInvitation` covering: success, 422-duplicate (idempotent), 429-retry-success, 429-retry-fail-then-rate-limited, 5xx-rollback.
- Manual: invite a fresh email via `/admin/learners` → Clerk dashboard shows pending invite → accept via the dev inbox link → lands on `/post-signin` → `/practice/writing`.

**Gate:** `pnpm --filter @elc/db test` green; manual happy-path invite end-to-end successful.

---

### Phase 3 — Brand polish on `/sign-in` and `/sign-up`

**Read first:** `.claude/skills/brand-system/SKILL.md`, `.claude/rules/brand.md`, and the existing sign-in/sign-up files for reference styling.

**Tasks**
- Restyle `apps/web/app/sign-in/[[...sign-in]]/page.tsx` and `apps/web/app/sign-up/[[...sign-up]]/page.tsx` as a two-pane layout at ≥768px:
  - Left half: black hero panel with the wordmark, the `font-display italic` tagline ("Skills That Open Doorways."), and a single line of supporting copy.
  - Right half: white card with the Clerk widget.
  - Stacked on mobile (<768px): hero collapses to a thin header.
- Audit `apps/web/lib/auth/clerk-appearance.ts` against every Clerk widget state (sign-in, sign-up, forgot password, MFA prompt, email verification). Add element overrides anywhere the default styling leaks through.
- Brand sweep `/no-access` and `/post-signin`. They are mostly there; verify against the brand-system checklist.

**Verification**
- Manual visual review at 320 / 768 / 1280 / 1920 viewports for both pages and every Clerk widget state.
- Add `@axe-core/playwright` check to the Phase-5 sign-in E2E spec covering `/sign-in`.
- Brand checklist: red+black+white+greys only, Rubik only, one primary red CTA per view, visible focus rings on every interactive element, ≥4.5:1 contrast.

**Gate:** Visual review approved; axe finds zero violations on `/sign-in` and `/sign-up`.

---

### Phase 4 — Role-aware landing copy

**Read first:** the existing `(super)/orgs/page.tsx`, `(admin)/admin/page.tsx`, and the learner home page to understand current layout.

**Tasks**
- On each role's landing route, pull the User's `name` (fallback to email local-part) and inject a greeting block near the top:
  - SuperAdmin (`/orgs`): "Welcome back, {firstName}. Skills That Open Doorways — admin view."
  - OrgAdmin (`/admin`): "Welcome back, {firstName}. Your learners. Your insights."
  - Learner (Practice home): "Welcome back, {firstName}. Let's drill — Skills That Open Doorways."
- Optional polish: add a 200ms branded splash on `/post-signin` if the redirect roundtrip is perceptible.

**Verification**
- Manual: each role sees the correct greeting on the right landing route.
- Snapshot or React-Testing-Library unit test per greeting component.

**Gate:** All three role greetings render correctly.

---

### Phase 5 — Playwright E2E for the three role logins

**Read first:** `apps/web/tests/e2e/` to see the existing suspend-gate spec for patterns; `@clerk/testing` docs for Playwright setup.

**Tasks**
- Install `@clerk/testing` in `apps/web`.
- New `apps/web/tests/e2e/role-login.spec.ts` with three tests:
  1. Sign in as `super@elanguage.dev` with `elanguagecenter2026!` → assert URL `/orgs` and greeting visible.
  2. Sign in as the seeded OrgAdmin (whichever email seed.ts uses) → assert `/admin` and greeting.
  3. Sign in as a seeded Learner → assert `/practice/writing` and greeting.
- Use Clerk's session-token bypass (`setupClerkTestingToken`) to skip the hosted UI in CI; sign out between tests to keep them isolated.
- Document dependency on `pnpm db:seed` having run (matches the suspend-gate convention).
- Add the axe check from Phase 3 here.

**Verification**
- `pnpm --filter web test:e2e` passes the new spec locally.

**Gate:** CI green on `role-login.spec.ts`.

---

### Phase 6 — Docs + ADR

**Tasks**
- `SETUP.md`:
  - Required envs: `CLERK_SECRET_KEY`, `APP_URL`. Optional: `SEED_DEFAULT_PASSWORD`, `SEED_SKIP_CLERK`.
  - Demo creds table (all 7 seeded users + their roles + the password).
  - New section "**Manual Clerk dashboard config**" listing: webhook endpoint URL per environment, allowed redirect URLs, email-template branding (logo, colors, sender).
- `packages/db/README.md`: seed-time Clerk side-effects + the production refusal + `SEED_SKIP_CLERK` escape hatch.
- `CLAUDE.md` Auth section: add bullets for seed creds (and the asymmetry — Learners have no Clerk org membership) + Clerk Invitations as the new-user path.
- `docs/adr/0013-clerk-seed-and-invitations.md`: rationale for the dev seed-password choice + Clerk Invitations over our own email send + the deliberate Learner-membership asymmetry.

**Verification:** Re-read each doc end-to-end; cross-link consistency check.

**Gate:** All docs landed; ADR-0013 committed.

---

## Tenant isolation impact

- `clerk-seed.ts` — system-level write across multiple orgs. Acceptable; mirrors the existing `seed.ts` pattern. Uses **raw `prisma`** (not `withOrg`) because seed runs without an `OrgContext`. Mirrors `clerk-sync.ts`. Document this clearly with a comment at the top of the file.
- `inviteLearnerForOrg` — already routes through `withOrg(ctx)` for the `ActivityLog` write. The new Clerk Invitations call is global (Clerk-side, not tenant-scoped in our DB), but the invitation's `publicMetadata.org_id` carries the calling org's id so the webhook lazy-link stays correct.
- No new queries are added to UI routes; the role landings already use `requireOrgContext()` + `withOrg(ctx)`.
- `/audit-tenancy` must be run before any PR is opened, with particular attention to `clerk-seed.ts` ensuring it never escapes into application code paths.

## AI cost impact

**Zero.** Auth flow makes no LLM, TTS, STT, or realtime AI calls. No gateway change, no quota change.

## Brand impact

New / refreshed surfaces: `/sign-in`, `/sign-up`, `/post-signin`, `/no-access`, plus greeting blocks on `/orgs`, `/admin`, learner home. All must satisfy the brand-system checklist (red+black+white+greys only, Rubik only, one primary red CTA per view, visible focus rings, ≥4.5:1 contrast, tested at 320/768/1280/1920). Clerk widget styling stays centralised in `clerk-appearance.ts` so any future token change drifts in one place.

## Risks

| Risk | Mitigation |
|---|---|
| Seed runs against production by accident → 7 real prod users get a shared password. | Hard refuse if `NODE_ENV=production`; loud doc warnings; require `CLERK_SECRET_KEY` to be explicitly set so production deploys without it cannot trigger seeding. |
| Clerk-side state diverges from DB (user created in Clerk but seed crashes before stamping `clerk_user_id`). | Idempotent path: re-run seed fetches the existing Clerk user by email and stamps the id. |
| Clerk Invitations email never lands (dev SMTP, spam folder). | `/dev/login` cookie path stays in place as the dev escape hatch; doc the Clerk dashboard "resend invitation" button. |
| Webhook lazy-link race during Phase 2 (Clerk's `user.created` arrives before our redirect). | Already handled by the existing lazy-link in `requireOrgContext` + `applyClerkUserUpsert` — both match by email idempotently. |
| The known webhook out-of-order bug collides with the new invitation flow. | Out of scope here — tracked in project memory `webhook-ordering-followup`. The invitation flow doesn't make it worse; do not "fix" it as a side quest. |
| Clerk widget looks unbranded in some sub-state (forgot password, MFA, email verify). | Phase 3 explicitly enumerates every Clerk widget state in the verification gate. |

---

## Execution rules (binding)

1. **Phase-by-phase.** After each phase, run its verification gate, report results, and STOP. Wait for explicit "continue" before the next phase.
2. **Commit per phase** with a `feat(auth):` (Phases 1, 2, 4, 5) or `feat(brand):` (Phase 3) or `docs:` (Phase 6) prefix. Stay on `main`. Push only when asked.
3. **Run `/audit-tenancy` before opening any PR** — it covers `clerk-seed.ts` and the extended invite path.
4. **Do not fix the webhook-ordering bug** during this work. It's a known separate follow-up.
5. **`/dev/login` stays.** It's the offline-dev escape hatch and is already production-hidden.
