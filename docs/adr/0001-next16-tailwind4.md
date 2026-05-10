# ADR 0001 — Adopt Next.js 16 and Tailwind 4 for `apps/web`

- **Status:** Accepted
- **Date:** 2026-05-08
- **Deciders:** yujith (with Claude Code in the scaffold session)

## Context

The architecture rules at `.claude/rules/architecture.md` specify "Next.js 14+ App Router" and "Tailwind" without a version pin. The brand skill at `.claude/skills/brand-system/SKILL.md` shows a Tailwind 3 shape: a `tailwind.config.ts` file with a JS preset that re-exposes brand tokens via `theme.extend.colors.brand.*`.

When scaffolding `apps/web` via `pnpm create next-app@latest`, the CLI installed:

- **Next.js 16.2.6** (App Router; React 19; default bundler is Turbopack)
- **Tailwind 4.2.4** with `@tailwindcss/postcss`
- **No `tailwind.config.ts`** — Tailwind 4 reads design tokens from CSS via `@import "tailwindcss"` + `@theme` directives.

This is technically allowed by the rule's "14+" wording but materially deviates from the brand skill's prescribed configuration shape. We discussed three options:

1. Adopt Next 16 + Tailwind 4 (what the CLI gave us). **Chosen.**
2. Pin Next 14 + Tailwind 3 to match the rules and skill literally.
3. Pin Next 15 + Tailwind 3 as a middle ground.

## Decision

Adopt **Next.js 16 + Tailwind 4 + React 19** for `apps/web`. Replace the Tailwind 3 JS preset in `packages/ui` with a Tailwind 4 `@theme inline` block in `packages/ui/src/tokens.css`. `apps/web/app/globals.css` imports both `tailwindcss` and `@elc/ui/tokens.css`, with an explicit `@source` directive to scan the workspace package for utility classes.

The brand token *values* are unchanged — same red, same black, same Rubik. Only the configuration *syntax* changed.

## Consequences

### Positive

- Latest framework features (Turbopack default in dev and build, React 19 server components, faster iterations).
- Tailwind 4 CSS-first config is significantly cleaner — design tokens live with the styles they configure, no JS round-trip.
- `@theme inline` keeps brand tokens themable at runtime via `:root` overrides (the `inline` modifier preserves `var(...)` references in generated utilities instead of baking values).
- One source of truth (`packages/ui/src/tokens.css`) drives both raw CSS variables and the Tailwind utility surface.

### Negative / risks

- **Brand skill is now stale.** `.claude/skills/brand-system/SKILL.md` shows the Tailwind 3 preset shape. A follow-up task (P1) should update the skill to show the Tailwind 4 `@theme inline` shape, and amend the architecture rules' Tailwind row to read "Tailwind 4" explicitly. Until then, the skill carries a pointer to this ADR and `tokens.css` carries a comment to the same effect.
- **React 19 is recent.** Some libraries (Clerk, shadcn primitives, etc.) may have rough edges. Reassess at the auth + DB scaffold stage.
- **Next 16 conventions may differ from training-data examples.** The `apps/web/AGENTS.md` shipped by `create-next-app` specifically warns about this. Future sessions should prefer reading the actual installed package docs over recalling Next 14 patterns.
- **`tailwind.config.ts` is gone.** Anyone looking for it (including future Claude sessions or new contributors) needs to know to look at `apps/web/app/globals.css` and `packages/ui/src/tokens.css` instead.

### Neutral

- The `<RegisterNowButton>` primitive in `packages/ui` is unchanged — it consumes `bg-brand-red`, `rounded-pill`, etc. as Tailwind utility classes regardless of which version generates them.

## Follow-up tasks

- [ ] Update `.claude/skills/brand-system/SKILL.md` to show the Tailwind 4 `@theme inline` shape and link this ADR.
- [ ] Update `.claude/rules/architecture.md` Tailwind row to read "Tailwind 4 (CSS-first config)".
- [ ] Spot-check Clerk + shadcn compatibility with React 19 before the auth scaffold session.
- [ ] When real brand assets land, verify the `Wordmark` text placeholder is replaced with the SVG without the @theme tokens drifting.

## Related

- `packages/ui/src/tokens.css` — canonical brand tokens, now in `@theme inline` form.
- `apps/web/app/globals.css` — `@import "tailwindcss"`, `@import "@elc/ui/tokens.css"`, `@source` for the workspace package, and the Rubik `@font-face` stubs.
- `.claude/rules/brand.md`, `docs/BRAND.md` — voice and visual handbook (unchanged).
