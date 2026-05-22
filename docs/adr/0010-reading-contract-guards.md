# ADR 0010 — Reading contract guards on generation, moderation, and approval

Status: Accepted
Date: 2026-05-18

## Context

The Reading pipeline already had the core pieces of a generation contract:

- `prompts/generation/reading.md` defines the canonical IELTS Reading shape.
- `packages/ai/src/generation/schema.ts` enforces the JSON structure.
- `packages/ai/src/generation/validate.ts` enforces semantic rules such as
  passage word-count windows and answer-in-passage checks.

Two gaps remained:

1. **Moderation approval trusted persistence, not current validity.** A
   `PendingReview` Reading test could be approved without re-checking whether
   its stored `body_json` and question payloads still satisfied the Reading
   contract.
2. **The review page could strand malformed content.** If `Test.body_json`
   stopped parsing as a Reading passage, the SuperAdmin page returned `404`
   instead of keeping the moderation UI available for rejection.

Because Reading content is learner-visible, these gaps were too risky to leave
to reviewer memory alone.

## Decisions

### D1 — Reuse the generation validator during Reading moderation

The Reading review flow now reconstructs a `GeneratedReading`-shaped object
from the persisted `Test` + `Question` rows and re-runs the same contract
checks used at generation time.

This happens before approving a pending Reading test.

Result: approval cannot promote a Reading test whose stored data no longer
matches the canonical generation contract.

### D2 — Approval requires renderable Reading data, not just schema-valid JSON

Schema-valid Reading data is not sufficient if the app cannot actually render
it. Before approval, moderation now also requires:

- `Test.body_json` must parse through `parseReadingPassage()`, and
- every `Question.correct_answer` must parse through the question-type payload
  parser for its stored `Question.type`.

If either runtime parser fails, approval is blocked.

### D3 — Tighten the Reading validator to match the prompt spec

`packages/ai/src/generation/validate.ts` now enforces the parts of the prompt
spec that were previously documented but not checked:

- **General Training passages**
  - must include `passage.gt_context`
- **Paragraph contract**
  - Academic passages must have 5–7 paragraphs
  - General Training passages must have 4–6 paragraphs
  - paragraph labels must be `A`, `B`, `C`, … in order
- **Question contract**
  - each Reading generation must have 6–10 questions
  - `position` values must be 0-indexed and contiguous in display order
- **Track mismatch**
  - generator-side caller/model track mismatches now emit `track.mismatch`
    instead of reusing an unrelated word-count code

This keeps the validator aligned with `prompts/generation/reading.md`.

### D4 — Review UI stays usable for malformed content

The Reading review page now surfaces stable validation issue codes and disables
the approve button while the test is out of contract, but rejection remains
available even when the stored passage payload cannot be rendered.

This makes moderation resilient instead of failing closed into `404`.

## Consequences

- Existing pending Reading tests with malformed passage payloads, malformed
  question payloads, missing GT context, bad paragraph labels, or invalid
  question counts/positions must be fixed or rejected before approval.
- Future changes to the Reading prompt contract should update:
  - `prompts/generation/reading.md`
  - `packages/ai/src/generation/schema.ts`
  - `packages/ai/src/generation/validate.ts`
  - `apps/web/lib/reading/review-validation.ts`

## Alternatives considered

- **Trust the reviewer and keep approval permissive.**
  Rejected. Reviewers are valuable, but learner-facing IELTS contracts still
  need a mechanical guardrail.

- **Treat malformed passage data as `404` on the review page.**
  Rejected. That removes the moderator's ability to reject the broken test
  through the normal workflow.

- **Create a second Reading-only validator inside `apps/web`.**
  Rejected. Moderation should reuse the canonical Reading contract, not drift
  into a separate app-only rule set.
