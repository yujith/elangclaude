# ADR 0009 — Writing contract guards on generation, moderation, and approval

Status: Accepted
Date: 2026-05-18

## Context

The Writing pipeline already had a strong generation contract:

- `prompts/generation/writing.md` defines the canonical IELTS Task 1 / Task 2
  shapes.
- `packages/ai/src/generation/writing-schema.ts` enforces the JSON structure.
- `packages/ai/src/generation/writing-validate.ts` enforces semantic rules such
  as word-target lines and visual consistency.

Two gaps remained:

1. **Manual moderation edits could bypass the contract.** A SuperAdmin could
   change the stored prompt text directly in the Writing review UI, then
   approve a task whose wording no longer matched the IELTS format.
2. **Approval trusted persistence, not current validity.** An Academic Task 1
   with an unrenderable `Question.visual`, or a task whose metadata no longer
   matched its prompt, could still be promoted to `Approved`.

Because Writing tasks are the exact learner-visible contract, these gaps were
too risky to leave in a human-review-only workflow.

## Decisions

### D1 — Reuse the generation validator during moderation

The Writing review flow now reconstructs a `GeneratedWriting`-shaped object
from the persisted `Test` + `Question` rows and re-runs the same contract
checks used at generation time.

This happens:

- before saving a manual prompt edit, and
- before approving a pending task.

Result: moderation cannot weaken the IELTS contract without tripping the same
 validator that generation uses.

### D2 — Academic Task 1 approval requires a renderable visual

For `writing-task-1-academic`, semantic validity is not enough. The visual must
also be renderable by the app's learner/admin renderer
(`apps/web/lib/writing/visual.ts`).

If the stored visual parses at the schema layer but fails the renderer
contract, approval is blocked.

### D3 — Tighten the Writing validator to match the prompt spec

`packages/ai/src/generation/writing-validate.ts` now enforces the parts of the
prompt spec that were previously written down but not checked:

- **General Task 1 letters**
  - must include `You do NOT need to write any addresses.`
  - must include `Begin your letter as follows:`
  - must use a salutation that matches the declared `register`
- **Task 2 essays**
  - must use the instruction that matches the declared
    `body_meta.question_subtype`

This keeps stored metadata (`register`, `question_subtype`) aligned with the
prompt a learner actually sees.

### D4 — Review UI shows why approval is blocked

The Writing review page surfaces stable validation issue codes when a task is
not approvable. The approve button is disabled while the task is out of
contract, but rejection remains available.

This makes the moderation surface explainable instead of silently failing or
relying on reviewer memory.

## Consequences

- Writing prompt edits are no longer "free text with a length bound"; they are
  contract-checked edits.
- Existing pending Writing tasks with malformed visuals or non-canonical prompt
  scaffolds must be fixed or rejected before approval.
- Future changes to the Writing prompt contract should update:
  - `prompts/generation/writing.md`
  - `packages/ai/src/generation/writing-schema.ts`
  - `packages/ai/src/generation/writing-validate.ts`
  - `apps/web/lib/writing/review-validation.ts`

## Alternatives considered

- **Trust the reviewer and keep approval permissive.**
  Rejected. Human review is valuable, but the product still needs a mechanical
  guardrail for learner-visible IELTS format rules.

- **Duplicate a second validator in `apps/web`.**
  Rejected. The app should reuse the canonical Writing generation contract
  instead of inventing a slightly different moderation-only rule set.

- **Block only approval, not edits.**
  Rejected. That would still let invalid prompt text be written to the database,
  leaving the review page to manage broken intermediate states indefinitely.
