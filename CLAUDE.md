# eLanguage Center — Claude Code Memory

> Last updated: 2026-05-09. If this file contradicts newer code, code wins — flag the drift.

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
```

See `packages/db/README.md` for the Neon dev + test-branch setup that `db:migrate:dev` and `pnpm test` depend on, and `docs/adr/0002-neon-test-branch-for-fuzzer.md` for the rationale behind the test-branch deviation from the architecture rule.

Wired but deferred:

```bash
pnpm test:e2e             # → Playwright. Lands in the auth/learner-flow scaffold.
```

If any of the *currently working* commands fails on a fresh clone, **fix this file first**, then the code.

## Stack version note (2026-05-08 scaffold)

`apps/web` runs on Next.js 16 + React 19 + Tailwind 4. Tailwind 4 uses CSS-first config (no `tailwind.config.ts`) — design tokens live in `packages/ui/src/tokens.css` via `@theme inline`. See `docs/adr/0001-next16-tailwind4.md` for the deviation from the Tailwind 3 shape shown in `.claude/skills/brand-system/SKILL.md`. The skill itself is on the follow-up list to update.

## Architecture in one paragraph

Next.js 14 App Router (TypeScript) on Vercel. Postgres via Prisma. Auth via Clerk (orgs are first-class). Object storage on Cloudflare R2 for Speaking recordings. LLM gateway via OpenRouter for cheap generation, **Claude Sonnet** for Writing/Speaking grading, OpenAI Realtime API for Speaking conversation, Whisper for transcription, ElevenLabs/OpenAI TTS for Listening audio. Sentry for errors, PostHog for product analytics. Single repo: `apps/web` + `packages/{db,ai,ui}`.

## Hard rules — non-negotiable

<important if="touching any database query or API route">
**EVERY query MUST be scoped by `org_id`.** Never trust client-provided IDs. Use the `withOrg(ctx)` helper from `packages/db/src/tenancy.ts`. If you write a Prisma query without an `orgId` filter, that's a P0 security bug. See `.claude/rules/multi-tenancy.md`.
</important>

<important if="calling any LLM or TTS provider">
**EVERY AI call MUST go through `packages/ai/src/gateway.ts`** which enforces per-user quotas server-side, logs token usage to `QuotaUsage`, and attributes cost per `org_id`. Never call an LLM SDK directly from a route handler. See `.claude/rules/ai-cost-control.md`.
</important>

<important if="building UI">
**Use the brand system.** Red `#E63027` + black `#0A0A0A` are the only primaries. Rubik is the only font (Extra Bold Italic display, Bold headlines, Medium body). Never introduce a new color or font without updating `.claude/skills/brand-system/SKILL.md` first. See `docs/BRAND.md`.
</important>

<important if="generating IELTS content or grading prompts">
**Read `.claude/skills/ielts-domain/SKILL.md`** before writing any test generation or grading prompt. IELTS has specific question types per section, specific band descriptors per criterion, and getting these wrong undermines the whole product.
</important>

## Roles & permissions (RBAC)

`SuperAdmin` > `OrgAdmin` > `Reviewer (Phase 2)` > `Learner`. Permissions are checked in `packages/db/src/auth/can.ts`. Never check roles inline in components — call `can(user, action, resource)`.

## Data model — quick map

```
Organization (id, name, seat_limit, quota_daily, quota_monthly)
└─ User (id, org_id, role, ielts_track)
   └─ Attempt (id, user_id, test_id, section, started_at, submitted_at)
      ├─ Answer (id, attempt_id, question_id, response, is_correct)
      ├─ Grade (id, attempt_id, band_overall, criteria_scores_json, graded_by)
      └─ Recording (id, attempt_id, storage_url, duration_sec)  -- Speaking
Test (id, track, section, difficulty, status, approved_by)
└─ Question (id, test_id, type, prompt, correct_answer, points)
QuotaUsage (id, user_id, date, ai_calls_count)
ActivityLog (id, org_id, user_id, action, metadata, timestamp)
```

Full schema lives in `packages/db/prisma/schema.prisma`. **That file is canonical** — if this README disagrees, trust the schema.

## Folder layout

```
apps/web/              Next.js app (UI + API routes)
  app/(learner)/       Learner-facing routes
  app/(admin)/         Org admin dashboard
  app/(super)/         SuperAdmin console
  app/api/             API routes (all org-scoped)
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
