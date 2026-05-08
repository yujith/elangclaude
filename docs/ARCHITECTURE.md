# Architecture

> Companion to `.claude/rules/architecture.md`. Written for humans onboarding to the project.

## System overview

```
                ┌────────────────────────────────────────────┐
                │              Vercel (Edge + Node)          │
                │  ┌───────────────────────────────────────┐ │
                │  │  Next.js 14 App Router (TypeScript)   │ │
                │  │                                       │ │
                │  │  (learner)/   (admin)/   (super)/     │ │
                │  │       │           │          │        │ │
                │  │       └───────────┴──────────┘        │ │
                │  │           Server Actions / API        │ │
                │  └───────────────────────────────────────┘ │
                └─────────┬───────────────┬──────────────────┘
                          │               │
              ┌───────────▼─────┐  ┌──────▼──────────────┐
              │  Postgres       │  │  AI Gateway         │
              │  (Neon / RDS)   │  │  packages/ai        │
              │                 │  │  ┌───────────────┐  │
              │  Prisma ORM     │  │  │ OpenRouter    │  │
              │  +              │  │  │ (cheap gen)   │  │
              │  withOrg()      │  │  ├───────────────┤  │
              │  proxy          │  │  │ Anthropic     │  │
              └─────────────────┘  │  │ (grading)     │  │
                                   │  ├───────────────┤  │
              ┌─────────────────┐  │  │ OpenAI        │  │
              │  Cloudflare R2  │  │  │ Realtime+TTS  │  │
              │                 │  │  ├───────────────┤  │
              │  Speaking       │  │  │ ElevenLabs    │  │
              │  recordings     │  │  │ (TTS)         │  │
              │                 │  │  └───────────────┘  │
              └─────────────────┘  └─────────────────────┘
                          │
                          ▼
                  Quota gate + cost log
                  (per user, per org)
```

## Multi-tenancy

Single Postgres database. Every tenant-scoped table has `org_id`. Application code accesses Prisma exclusively through `withOrg(ctx)` (or the explicit `withSuperAdminContext` for global tooling). See `.claude/skills/multi-tenant-prisma/SKILL.md` for the full contract.

## Auth

Clerk owns identity and orgs. Sessions carry the user's role and current org. The first thing every protected route does is `await requireOrgContext(req)`. Role checks go through `can(user, action, resource)` — never inline.

Roles in MVP: `SuperAdmin`, `OrgAdmin`, `Learner`. `Reviewer` ships in Phase 2.

## AI architecture

Every AI call goes through `packages/ai/src/gateway.ts`. The gateway:

1. Reads the caller's quota state.
2. Routes the call to the appropriate provider based on `purpose`.
3. Logs token usage, attributing cost to `org_id`.
4. Returns the response or throws `QuotaExceededError`.

Providers:
- **OpenRouter** — bulk content generation (Reading passages, Listening scripts, Writing prompts). Cheap models (Llama 3, Gemini Flash, Mistral) via `purpose: "*-generation"`.
- **Anthropic Claude Sonnet** — Writing and Speaking grading. Expensive but defensible.
- **OpenAI Realtime API** — Speaking conversation (WebRTC, low latency).
- **Whisper** — Speaking transcription before grading.
- **ElevenLabs / OpenAI TTS** — Listening audio generation. Cached by `(text, voice, accent)` hash.

## Speaking flow (the most complex feature)

```
Learner clicks "Start Speaking"
   │
   ▼
Browser opens WebRTC session ── handshake via signed token from server ─→ OpenAI Realtime
   │                                                                           │
   ▼                                                                           │
Real-time bidirectional audio                                                  │
(server holds the persona prompt; client just streams audio)                   │
   │                                                                           │
   ▼                                                                           │
Learner ends session                                                           │
   │                                                                           ▼
   ▼                                                                  Audio returned to server
Server uploads recording to R2 (org_id-prefixed key)                           │
   │                                                                           ▼
   ▼                                                                   Server creates Recording row
Server queues a transcription job                                              │
   │                                                                           ▼
   ▼                                                                   Whisper transcribes
   ▼                                                                           │
   ▼                                                                           ▼
Server queues a grading job ───── Whisper transcript + audio features ──→ Claude Sonnet (rubric)
   │                                                                           │
   ▼                                                                           ▼
Grade row inserted, learner notified                                  Score + criterion feedback
```

Cost watch: a 10-minute Speaking session is the most expensive single user action in the product. Modeled cost cap goes into the org's `quota_daily`.

## Caching strategy

- **Tests**: AI generates only when the user has exhausted their available pool. New tests enter the global pool, are SuperAdmin-approved, then served to all users. No org-private generation in MVP.
- **TTS audio**: deduped by hash. The same listening passage with the same voice never re-synthesizes.
- **Grading**: never cached. Each attempt graded fresh.

## Background jobs

Vercel Cron + Upstash QStash for queue processing. Jobs:
- Daily quota reset (midnight UTC).
- Recording cleanup (per-org retention, default 90 days).
- Anchor calibration runs after grading prompt updates.
- AI cost rollups for SuperAdmin dashboard.

## Data isolation summary

| Surface | Isolation mechanism |
|---|---|
| DB | `withOrg(ctx)` proxy injects `org_id` into every query |
| Storage | R2 keys prefixed with `org_id`, signed URLs only |
| Cache | Keys lead with `org:${org_id}:` |
| Logs | Every entry tagged with `org_id` |
| Auth | Clerk session is the only source of `org_id` |
| Tests | `tenancy.test.ts` fuzzer runs in CI |

## Deployment

- Vercel for the Next.js app (preview deploys per PR).
- Neon for Postgres (separate dev/preview/prod branches).
- Cloudflare R2 for object storage.
- Sentry for errors. PostHog for product analytics.
- GitHub Actions for CI (typecheck, lint, test, fuzzer, build).

## Out of scope for MVP

Reviewer/human-grading workflow, native mobile apps, languages other than English, SSO, custom org branding, cohort analytics, live tutors, self-serve Stripe billing. See `docs/ROADMAP.md` for phasing.
