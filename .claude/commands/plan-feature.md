---
description: Plan a new feature using the brief + brand + architecture rules. Always run this BEFORE writing code for anything non-trivial.
---

# /plan-feature

You are about to plan a feature for eLanguage Center. **Do not write any application code in this command.** Output a plan only.

## Step 1 — Interview the user

Use the AskUserQuestion tool to clarify *before* planning:

1. What is the feature (one sentence)?
2. Which user role(s) does it affect — SuperAdmin, OrgAdmin, Reviewer (Phase 2 only), Learner?
3. Which IELTS section(s) or admin surface(s) does it touch?
4. What's the minimum viable version vs. the dream version?
5. Any deadline or external dependency?

Skip questions whose answers are obvious from context.

## Step 2 — Gather context

Read these files in order (use the view tool, don't summarize from memory):
- `CLAUDE.md`
- `docs/BRIEF.md` for the source spec
- `.claude/rules/` (all four files)
- Relevant `.claude/skills/*/SKILL.md` based on what the feature touches
- The Prisma schema if data is involved
- Any existing routes/components in the area being modified

## Step 3 — Produce a phase-wise gated plan

Output in this exact structure:

```md
# Plan: {Feature Name}

## Goal (one paragraph)

## Scope
- IN: ...
- OUT: ...

## Affected layers
- [ ] DB schema (which models)
- [ ] API / Server Actions (which routes)
- [ ] UI (which routes/components)
- [ ] AI gateway (which prompts/purposes)
- [ ] Background jobs
- [ ] Tests
- [ ] Docs

## Phases (each with verification gate)

### Phase 1 — {name}
- Tasks:
- Verification: how do we know this works? (unit test? E2E? manual?)
- Gate: what must pass before Phase 2 starts?

### Phase 2 — {name}
...

## Tenant isolation impact
Does this touch tenant-scoped data? If yes, list every query and confirm each goes through `withOrg()`. If no, explain why.

## AI cost impact
Does this make any AI call? If yes, what's the model, the per-call cost estimate, the expected daily volume, and which quota purpose it bills against?

## Brand impact
New surfaces? Confirm they comply with `.claude/skills/brand-system/SKILL.md`.

## Open questions
List anything still ambiguous. Flag P0 questions that must be answered before any code is written.

## Risks
What could go wrong? What's the rollback if it does?
```

## Step 4 — Wait

Stop after producing the plan. **Do not start implementing.** Wait for the user to approve, modify, or hand the plan to a fresh Claude session for execution. (This is the cross-context handoff Boris recommends.)
