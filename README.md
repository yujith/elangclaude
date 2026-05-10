# eLanguage Center

> Skills That Open Doorways — Free. Fun. Effective.

A B2B SaaS for IELTS preparation. Organizations license seats; learners practice all four IELTS sections (Reading, Listening, Writing, Speaking) across Academic and General Training tracks with AI-generated content and AI-driven grading. Speaking is delivered as an interactive voice conversation with an AI examiner.

## Quickstart

```bash
# Prereqs: Node 20+, pnpm 9+ (via `corepack enable && corepack prepare pnpm@9 --activate`).
# Postgres / R2 / external services not yet required — they land with the DB scaffold session.

pnpm install
pnpm dev                          # http://localhost:3000 — homepage shell
```

> **Phase 0 status:** the scaffold currently ships only the static homepage shell. `pnpm db:*`, `pnpm test`, and `pnpm test:e2e` are stubbed with informative non-zero exits and land in the next scaffold sessions. See `CLAUDE.md` for the current working command list and `docs/adr/0001-next16-tailwind4.md` for the Next 16 / Tailwind 4 stack notes.

## Working with Claude Code

This repo is set up for Claude Code from day one. The `.claude/` directory contains:

- `settings.json` — model, permissions, status line.
- `rules/` — auto-loaded memory: architecture, multi-tenancy, AI cost control, brand.
- `skills/` — domain knowledge that loads on demand: IELTS, multi-tenant Prisma, brand system, AI grading.
- `commands/` — slash commands: `/plan-feature`, `/audit-tenancy`, `/ship-feature`.
- `agents/` — subagents: `architect`, `tenant-isolation-auditor`.

Start every session in plan mode and use `/plan-feature` for anything non-trivial. Run `/audit-tenancy` before merging anything that touches the database. Run `/ship-feature` as the final pre-merge gate.

## Repo layout

```
apps/web/              # Next.js 14 app (UI + API)
packages/db/           # Prisma schema + tenancy helpers
packages/ai/           # AI gateway, grading, prompts
packages/ui/           # Shared shadcn primitives + brand tokens
prompts/               # Versioned generation + grading prompts
docs/                  # BRIEF, ARCHITECTURE, BRAND, ROADMAP
.claude/               # Claude Code memory / skills / commands / agents
```

## Documentation

- `docs/BRIEF.md` — the source product spec.
- `docs/ARCHITECTURE.md` — system design.
- `docs/BRAND.md` — visual + voice handbook.
- `docs/ROADMAP.md` — what's in MVP, what's Phase 2/3.
- `CLAUDE.md` — Claude Code's primary memory file.

## Contributing

1. Branch from `main`. Use Conventional Commits.
2. Open a draft PR early; iterate.
3. Before requesting review: run `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`.
4. Run `/audit-tenancy` and `/ship-feature` in Claude Code.
5. PR description should answer: what changed, why, how it was tested, any rollback steps.

## License

Proprietary. All rights reserved.
