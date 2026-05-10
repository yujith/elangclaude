# ADR 0002 — Neon test branch for the tenancy fuzzer + integration tests

- **Status:** Accepted
- **Date:** 2026-05-09
- **Deciders:** yujith (with Claude Code in the DB scaffold session)

## Context

`.claude/rules/architecture.md` says, under Testing:

> Integration tests for API routes (with a real Postgres test container, not mocks).

The intent of that rule is sound — mocked databases hide migration bugs and behavioural drift between Prisma's query planner and real Postgres, both of which we got bitten by in past sprints. We agree with the intent.

The implementation, though, prescribes a Postgres **test container** (i.e. `@testcontainers/postgresql` spinning up a Docker image per run). Adopting that costs us:

- Docker as a hard contributor dependency (still painful on locked-down corporate machines and on Apple Silicon for some images).
- A second postgres container running alongside the Neon dev branch — two flavours of "real" Postgres in the same project.
- Slower cold-start for the fuzzer (the image, the boot, the migrations).

For this MVP we are already on **Neon** for dev and prod. Neon's selling point is cheap, near-instant copy-on-write **branches** — a fresh isolated Postgres database in seconds, no Docker, no container management.

## Decision

Use a dedicated **Neon branch named `test`** (split off the dev branch) as the database the tenancy fuzzer and future integration tests run against. Wire it via `DATABASE_URL_TEST` in `packages/db/.env`; the Vitest setup files force `DATABASE_URL = DATABASE_URL_TEST` before the Prisma client instantiates so production code paths remain untouched.

This satisfies the *intent* of the architecture rule — tests run against real Postgres, not mocks — while diverging from the *letter* (no Docker test container).

## Consequences

### Positive

- **Zero extra infra for contributors.** If you can clone, `pnpm install`, and `pnpm db:migrate:dev`, you can run the fuzzer.
- **Same engine in dev and test.** Neon's Postgres-with-branching avoids any drift between the test container's image version and the prod database.
- **Branch resets are trivial.** `neon branches reset test --parent dev` (or the API equivalent) gives a known-good baseline in seconds.

### Negative / risks

- **Network-dependent CI.** A Neon outage or DNS hiccup turns the fuzzer red. Mitigation: pin a `--retry=2` on the test command, and use a service-account API token in CI rather than the personal one.
- **Drift from `.claude/rules/architecture.md`.** Whoever reads that rule first may go set up testcontainers expecting it to be canonical. Mitigation: update that rule's testing row to read "Neon test branch (see ADR 0002) — testcontainers acceptable as a fallback for non-Neon environments." (Tracked in follow-ups below.)
- **Parallelism caveat.** The branch is shared, so `vitest` runs file-serially (`fileParallelism: false`). Test runtime grows with the suite. If that becomes painful, the rollback is a per-worker branch — Neon's branch API is fast enough to make this viable.
- **Cost.** Neon charges per branch hour and per write. Background test load is small; if it grows, we revisit.

### Neutral

- The fuzzer itself is portable. Switching to testcontainers later is a `vitest.config.ts` + `test-global-setup.ts` change — no test file rewrites.

## Rollback plan

Swap the test database without touching tenancy logic:

1. Add `@testcontainers/postgresql` as a `packages/db` devDep.
2. Replace `test-global-setup.ts` with one that boots a container and exposes its connection string.
3. Drop the `DATABASE_URL_TEST` requirement from `test-setup.ts`.

Total surface: two files.

## Follow-up tasks

- [ ] Update `.claude/rules/architecture.md` Testing row to reference this ADR.
- [ ] Add `--retry=2` (or an equivalent vitest flag) to the fuzzer's CI command once we wire CI.
- [ ] Document the `neon branches reset test --parent dev` workflow in `packages/db/README.md` once the team has a shared Neon project ID.

## Related

- `packages/db/README.md` — first-time setup instructions for both dev and test branches.
- `packages/db/src/test-setup.ts`, `src/test-global-setup.ts` — env override + `prisma migrate deploy` against the test branch.
- `.claude/skills/multi-tenant-prisma/SKILL.md` — the fuzzer pattern this ADR's database choice supports.
