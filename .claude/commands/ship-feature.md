---
description: Final pre-merge gate. Runs the full quality bar before a PR can ship. Don't skip steps.
---

# /ship-feature

Run these in order. Stop at the first failure and report.

## 1. Tenancy audit
Invoke `/audit-tenancy` against the diff. P0 findings → stop.

## 2. Tests
```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e --reporter=line
```
Any red → stop.

## 3. Tenancy fuzzer
```bash
pnpm test packages/db/src/tenancy.test.ts --repeat-each=20
```
Any failure → stop. This is non-negotiable.

## 4. Build
```bash
pnpm build
```
Catches Server Component / Client Component boundary mistakes that lint missed.

## 5. Brand smoke check
For any UI changes, verify against `.claude/skills/brand-system/SKILL.md` checklist:
- Only brand colors used? (grep for hex codes outside `tokens.css`)
- Only Rubik used? (grep for `font-family` outside `tokens.css`)
- One primary CTA per surface?
- Focus rings visible?

## 6. AI cost sanity
For any new AI calls:
- Goes through the gateway? (`grep -r "import.*ai/gateway"` in changed files)
- Quota purpose tagged?
- Model choice matches the cheat sheet in `.claude/rules/ai-cost-control.md`?

## 7. Migration safety
For any Prisma migration:
- Does it `DROP` anything? Confirm with the user.
- Does it require a backfill? Is the backfill in a separate migration *before* this one?
- Reviewed the generated SQL, not just the schema diff?

## 8. CLAUDE.md sync
If you added a major new module, command, skill, or convention — is it referenced from `CLAUDE.md` or `.claude/rules/`?

## 9. Commit message
Conventional Commits: `feat(scope): summary`, `fix(scope): summary`, etc. Include the user-visible change in one line.

## 10. Output

```md
# Ship Report — {feature}

✅ Tenancy audit clean
✅ Typecheck/lint/tests/E2E green
✅ Tenancy fuzzer 20× clean
✅ Build green
✅ Brand smoke clean
✅ AI cost sane
✅ Migration safe (or N/A)
✅ Docs synced

Ready to merge.
```

If anything is yellow or red, the report says exactly what and why, and the recommendation is **do not merge yet**.
