# Architecture Rules

> Auto-loaded with every Claude Code session.

## Stack — locked in

| Layer | Choice | Don't reach for |
|---|---|---|
| Frontend | Next.js 14+ App Router, TypeScript, Tailwind, shadcn/ui | Pages Router, Vue, Svelte |
| Backend | Next.js API routes / Server Actions | Separate Express/Fastify (until scale demands it) |
| ORM | Prisma | Drizzle, Kysely, raw SQL (except in migrations) |
| Database | Postgres (Neon for dev, Supabase or RDS for prod) | MySQL, MongoDB |
| Auth | Clerk (orgs are first-class) | NextAuth, Auth0, hand-rolled |
| Object storage | Cloudflare R2 | S3 (cost), Vercel Blob (vendor lock) |
| Email | Resend | Sendgrid (slower, pricier for our volume) |
| LLM gateway | OpenRouter for cheap routes, direct Anthropic for grading | Calling provider SDKs from routes directly — see `ai-cost-control.md` |
| Realtime voice | OpenAI Realtime API (WebRTC) | Custom WebSocket setups for now |
| Hosting | Vercel | Self-hosted (until we have ops headcount) |
| Errors | Sentry | Bugsnag |
| Analytics | PostHog | Mixpanel, GA |
| Monorepo | pnpm workspaces | npm/yarn workspaces, Nx, Turborepo (until needed) |

If you want to deviate, **open an ADR in `docs/adr/`** before writing code.

## Code style

- **TypeScript strict mode.** No `any` without a `// eslint-disable-next-line` and a comment explaining why.
- **Server-first.** Server Components by default; `"use client"` only when you need interactivity.
- **Colocate.** Component, its styles, and its tests live together.
- **No barrel files** for performance-sensitive packages (`packages/ai`, `packages/db`).
- **Error boundaries** at every route segment.

## Testing

- Unit tests with **Vitest** for pure logic.
- Integration tests for API routes (with a real Postgres test container, not mocks).
- E2E with **Playwright** for the critical learner journey: invite → onboard → take section → see grade.
- Tenancy fuzzer (see `multi-tenancy.md`) is required and runs in CI.

## Security non-negotiables

- Rate limit auth endpoints (Upstash or Vercel KV).
- Signed URLs for all R2 access. Never expose raw object keys.
- Secrets via environment variables only. Never committed. Never logged. Never sent to the client (`NEXT_PUBLIC_*` is checked in CI).
- CSRF protection on Server Actions (Next.js handles by default — don't disable).
- Input validation with **Zod** at every boundary (route handlers, server actions).

## Performance budgets

- TTI under 2s on the dashboard.
- Test load under 2s.
- Speaking recording upload resilient to network drops (resumable upload via tus or signed multipart).
- Listening audio prefetched on test start.

## Accessibility

WCAG 2.1 AA, full stop. Keyboard nav, screen reader support, captions for Listening (auto-generated, reviewer can edit). Tests fail in CI if axe finds violations on key pages.
