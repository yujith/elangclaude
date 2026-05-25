# eLanguage Center — Claude Code Memory

> Last updated: 2026-05-18. If this file contradicts newer code, code wins — flag the drift.

## What we're building

A B2B SaaS for IELTS prep. Orgs (language schools, migration agencies, the British Council, etc.) buy seats. Learners practice **Reading, Listening, Writing, Speaking** across **Academic and General Training** tracks. AI generates content, AI grades, Speaking is a real-time voice conversation with an AI examiner.

**Tagline:** Skills That Open Doorways — Free. Fun. Effective.

## Run-the-tests-on-day-one commands

Currently working:

```bash
pnpm install
pnpm dev                  # Next.js dev server on :3000
pnpm lint
pnpm typecheck
pnpm build                # Static prerender of the homepage
pnpm db:generate          # Generates the Prisma client (no DB connection needed)
pnpm db:migrate:dev       # Applies migrations to DATABASE_URL — needs packages/db/.env
pnpm db:seed              # Idempotent: 1 SuperAdmin + 2 demo orgs
pnpm test                 # Vitest — runs the tenancy fuzzer against DATABASE_URL_TEST
pnpm --filter web test:e2e   # Playwright — currently covers the Suspended-org gate.
```

See `packages/db/README.md` for the Neon dev + test-branch setup (and optional `DATABASE_URL_NEON_CHILD` for a Neon **child branch**) that `db:migrate:dev` and `pnpm test` depend on, and `docs/adr/0002-neon-test-branch-for-fuzzer.md` for the rationale behind the test-branch deviation from the architecture rule.

E2E setup is one-time:

```bash
cd apps/web && pnpm exec playwright install chromium
```

If any of the *currently working* commands fails on a fresh clone, **fix this file first**, then the code.

## Stack version note (2026-05-08 scaffold)

`apps/web` runs on Next.js 16 + React 19 + Tailwind 4. Tailwind 4 uses CSS-first config (no `tailwind.config.ts`) — design tokens live in `packages/ui/src/tokens.css` via `@theme inline`. See `docs/adr/0001-next16-tailwind4.md` for the deviation from the Tailwind 3 shape shown in `.claude/skills/brand-system/SKILL.md`. The skill itself is on the follow-up list to update.

## Architecture in one paragraph

Next.js 14 App Router (TypeScript) on Vercel. Postgres via Prisma. Auth via Clerk (orgs are first-class). Object storage on Cloudflare R2 for Speaking recordings. LLM gateway via OpenRouter for cheap generation, **Claude Sonnet** for Writing/Speaking grading, OpenAI Realtime API for Speaking conversation, Whisper for transcription, ElevenLabs/OpenAI TTS for Listening audio. Sentry for errors, PostHog for product analytics. Single repo: `apps/web` + `packages/{db,ai,ui}`.

## Auth: Clerk is live

Clerk is the canonical auth backend (both dev and production). Org membership lives in our DB — `Organization` rows carry `clerk_org_id`, `User` rows carry `clerk_user_id`, and the Clerk webhook at `/api/clerk/webhook` is the source of truth keeping them in sync. Full rationale + the operational gotchas are in `docs/adr/0014-clerk-login-experience.md`.

- **Lazy-link by email:** when a Clerk user signs in and we have no `clerk_user_id` match, `requireOrgContext` looks up the DB row by email, stamps `clerk_user_id`, and **also stamps `name` from Clerk's `firstName + lastName` when present**. This is how seeded users (and webhook-created rows that beat the lazy-link request) get bound to a Clerk identity *and* pick up their real display name without waiting for a `user.updated` webhook.
- **SuperAdmin is DB-controlled, not Clerk-controlled.** A user becomes `SuperAdmin` only by an explicit DB write. The webhook never promotes anyone past `OrgAdmin`.
- **`/post-signin`** is the post-Clerk trampoline — loads `OrgContext` and routes by role (`/orgs`, `/admin`, `/practice/writing`). Uses `window.location.replace` (not `redirect()`) to escape Clerk's client-router stall on Next 16; see ADR-0014 D5.
- **`/no-access`** catches Clerk-authed users who aren't on any DB roster yet (no email match, or soft-deleted). Avoids the redirect loop a plain `/sign-in` would cause.
- **`/create-org`** renders Clerk's `<CreateOrganization />`. Webhook events on submission create the matching Org row + promote the creator to `OrgAdmin`.
- **`/dev/login`** stays as a dev-only escape hatch for switching between seeded users. Hidden in production.
- **Invitations land on `/sign-up`, not `/post-signin`.** `inviteLearnerForOrg` builds `redirectUrl: ${APP_URL}/sign-up` so Clerk's `<SignUp>` can read `__clerk_ticket` and bind the invitation to the new Clerk account. `/sign-up` then `fallbackRedirectUrl`s to `/post-signin` for role routing.
- **Learners get NO Clerk org membership** (decision in ADR-0014 D7). OrgAdmin + SuperAdmin home-org memberships use the prefixed role key `"org:admin"` — the unprefixed legacy `"admin"` returns 404 from Clerk's API.

DB-touching sync functions live in `packages/db/src/clerk-sync.ts` and are unit-tested in `clerk-sync.test.ts`. Webhook event types subscribed in the Clerk dashboard: `user.*`, `organization.*`, `organizationMembership.*`.

### Clerk env vars (all in `packages/db/.env`, picked up by `apps/web/next.config.ts`)

| Env | Used by | Required when |
|---|---|---|
| `CLERK_SECRET_KEY` | backend SDK (seed, invite, webhook) | always |
| `CLERK_PUBLISHABLE_KEY` | `<ClerkProvider>` on the client | always |
| `CLERK_WEBHOOK_SIGNING_SECRET` | webhook Svix signature check | when running with the webhook receiver |
| `APP_URL` | invitation `redirectUrl` build | any code path that calls `inviteLearnerForOrg` (throws `InviteEnvError` otherwise) |
| `SEED_DEFAULT_PASSWORD` | overrides the shared seed password | optional; defaults to `elanguagecenter2026!` |

### Clerk dashboard prereqs (manual, NOT in version control)

A fresh Clerk project needs these two settings flipped before the app behaves correctly. Both are recorded in ADR-0014 D7 / "Bad" so a re-init doesn't reintroduce the gates.

- **Configure → Organizations Settings → Membership: Optional** (default is "Required" which forces Learners into Clerk's org-setup wizard).
- **Configure → Sessions → Verify new device: off** (dev only — Clerk's per-email code can't be received at `@elanguage.dev` mailboxes during development). Keep it on in production.

## Hard rules — non-negotiable

<important if="touching any database query or API route">
**EVERY query MUST be scoped by `org_id`.** Never trust client-provided IDs. Use the `withOrg(ctx)` helper from `packages/db/src/tenancy.ts`. If you write a Prisma query without an `orgId` filter, that's a P0 security bug. See `.claude/rules/multi-tenancy.md`.
</important>

<important if="calling any LLM or TTS provider">
**EVERY AI call MUST go through `packages/ai/src/gateway.ts`** which enforces per-user quotas server-side, logs token usage to `QuotaUsage`, and attributes cost per `org_id`. Never call an LLM SDK directly from a route handler. See `.claude/rules/ai-cost-control.md`.
</important>

<important if="building UI">
**Use the brand system.** Red `#EE2346` + black `#0A0A0A` are the only primaries. Rubik is the only font (Extra Bold Italic display, Bold headlines, Medium body). Never introduce a new color or font without updating `.claude/skills/brand-system/SKILL.md` first. See `docs/BRAND.md`.
</important>

<important if="generating IELTS content or grading prompts">
**Read `.claude/skills/ielts-domain/SKILL.md`** before writing any test generation or grading prompt. IELTS has specific question types per section, specific band descriptors per criterion, and getting these wrong undermines the whole product.
</important>

<important if="touching Writing generation, Writing moderation, or Writing prompt edits">
**Writing tasks are contract-validated twice: at generation time and again before moderation edits/approval.** Manual prompt edits must preserve the canonical IELTS scaffold (GT letter lines, Task 2 subtype instruction, word-target lines), and Academic Task 1 must keep a renderable visual. See `docs/adr/0009-writing-contract-guards.md`.
</important>

<important if="touching Reading generation, Reading moderation, or Reading approval">
**Reading tests are contract-validated twice: at generation time and again before approval.** GT passages must carry `gt_context`; paragraph counts/labels and question counts/positions must stay aligned with the canonical Reading prompt contract; approval is blocked if `body_json` or any question payload no longer parses in the Reading renderer. See `docs/adr/0010-reading-contract-guards.md`.
</important>

<important if="touching Speaking generation, Speaking moderation, or Speaking approval">
**Speaking tests are contract-validated twice: at generation time and again before approval.** `body_json` must still satisfy the canonical Speaking prompt contract, Part 1 must open with home/work/study, Part 2 follow-ups and Part 3 discussion prompts must stay question-shaped, and the three thin anchor `Question` rows must still be present in the canonical `speaking-part-1` / `speaking-part-2-cue` / `speaking-part-3` order. See `docs/adr/0011-speaking-contract-guards.md`.
</important>

<important if="touching IELTS generation prompts, generator user-turn reminders, or semantic validators">
**The prompt markdown, generator user-turn reminders, and semantic validators are one contract.** Do not tighten or loosen only one layer. Reading GT always requires `gt_context`; Listening must keep the shortened-but-IELTS-like 4-part scaffold (contexts, speaker counts, narration cues, 5–8 questions per part, and accent variety); Writing Task 1 / Task 2 canonical instruction lines are exact; Speaking Part 3 must stay in the same topic domain as Part 2. See `docs/adr/0012-ielts-generation-prompt-fidelity.md`.
</important>

## Roles & permissions (RBAC)

`SuperAdmin` > `OrgAdmin` > `Reviewer (Phase 2)` > `Learner`. Permissions are checked in `packages/db/src/auth/can.ts`. Never check roles inline in components — call `can(user, action, resource)`.

## Data model — quick map

```
Organization (id, name, seat_limit, quota_daily, quota_monthly, status)
└─ User (id, org_id, role, ielts_track, deleted_at)   -- soft-delete: deleted_at != null hides + blocks sign-in
   └─ Attempt (id, user_id, test_id, section, started_at, submitted_at)
      ├─ Answer (id, attempt_id, question_id, response, is_correct)
      ├─ Grade (id, attempt_id, band_overall, criteria_scores_json, graded_by)
      └─ Recording (id, attempt_id, storage_url, duration_sec)  -- Speaking
Test (id, track, section, difficulty, status, approved_by)
└─ Question (id, test_id, type, prompt, correct_answer, points)
QuotaUsage (id, user_id, date, ai_calls_count)             -- per-user-per-day quota primitive
AiCallLog (id, org_id, user_id, purpose, model, input_tokens, output_tokens, cost_usd)  -- money primitive; gateway writes one row per call
ActivityLog (id, org_id, user_id, action, metadata, timestamp)
```

Full schema lives in `packages/db/prisma/schema.prisma`. **That file is canonical** — if this README disagrees, trust the schema.

### Singleton "system" Organization

Super-level events (org CRUD, content moderation, anything an OrgAdmin never originates) write `ActivityLog` rows under a fixed `Organization` with `id = "system"` (`SYSTEM_ORG_ID` in `@elc/db`). OrgAdmin views filter by their own `org_id` via `withOrg(ctx)` and therefore never see these rows. **Never write a `super.*` or `content.*` ActivityLog under a customer org's id.** See `packages/db/src/system-org.ts` and the migration `20260520194500_super_activity_to_system_org`.

## Folder layout

```
apps/web/              Next.js app (UI + API routes)
  app/(learner)/       Learner-facing routes
  app/(admin)/         Org admin dashboard
  app/(super)/         SuperAdmin console: /orgs, /orgs/[id]/users, /users, /metrics, /content
  app/suspended/       Public landing for Suspended/Archived orgs (OrgSuspendedError target)
  app/api/             API routes (all org-scoped)
  tests/e2e/           Playwright suite (suspend-gate today)
packages/db/           Prisma schema + tenancy helpers
packages/ai/           LLM clients, prompts, grading logic
packages/ui/           Shared shadcn components + brand tokens
prompts/               Versioned prompts (Markdown, reviewed in PRs)
  grading/{writing,speaking}.md
  generation/{reading,listening,writing,speaking}.md
docs/                  BRIEF.md, ARCHITECTURE.md, BRAND.md, ROADMAP.md
.claude/               Memory rules, skills, agents, commands
```

## What's IN MVP v1 (what to build now)

All 4 sections, both tracks, section practice + full mock, AI grading only (no human review yet), conversational Speaking AI with recording storage, org admin bulk invite + seat usage + activity log, SuperAdmin org/quota/content moderation, per-user quota enforcement, web responsive + PWA.

## What's OUT of MVP v1 (don't build yet)

Reviewer/human grading workflow → Phase 2. Native mobile apps → Phase 3. Other languages → Phase 3+. SSO → Phase 2. Custom org branding → Phase 2. Cohort analytics → Phase 2. Live tutors → not on roadmap. Stripe self-serve → Phase 2.

## When in doubt

1. Read `docs/BRIEF.md` (the source spec).
2. Check `.claude/rules/*.md` for the area you're touching.
3. Use `/plan-feature` slash command before writing code for anything non-trivial.
4. Use `/audit-tenancy` before merging anything that touches a query.
5. Commit at least once per hour. If you're about to do something destructive, **stop and ask.**

## Open questions still to validate (don't pretend these are settled)

- Speaking AI cost per 10-min session — model before scaling.
- AI grading defensibility — benchmark against published IELTS samples.
- Audio retention default — 90 days, configurable per org.
- What happens when a learner hits quota mid-test — current answer: complete current test, block new ones until reset.
