# ADR 0011 — Speaking contract guards on generation, moderation, and approval

Status: Accepted
Date: 2026-05-18

## Context

The Speaking pipeline already had a strong structural contract:

- `prompts/generation/speaking.md` defines the canonical IELTS Speaking shape.
- `packages/ai/src/generation/speaking-schema.ts` enforces the JSON structure.
- `packages/ai/src/generation/speaking-validate.ts` enforces core semantic
  rules such as cue-card phrasing and duplicate-prompt rejection.

Two gaps remained:

1. **Moderation approval trusted persistence, not current validity.** A
   `PendingReview` Speaking test could be approved without re-checking whether
   its stored `body_json` still satisfied the canonical generation contract.
2. **Approval did not validate the thin `Question` anchors.** Speaking runtime
   flows depend on exactly three `Question` rows (`speaking-part-1`,
   `speaking-part-2-cue`, `speaking-part-3`) in order, but moderation was not
   checking that those anchors still existed in the expected shape.

Because Speaking content is learner-visible and the transcript/runtime pipeline
keys off the part anchors, these gaps were too risky to leave to reviewer
memory.

## Decisions

### D1 — Reuse the generation validator during Speaking moderation

The Speaking review flow now reconstructs a `GeneratedSpeaking`-shaped object
from the persisted `Test` row and re-runs the same contract checks used at
generation time before approval.

Result: approval cannot promote a Speaking test whose stored script no longer
matches the canonical Speaking contract.

### D2 — Approval requires renderable `body_json` and valid Speaking anchors

Before approval, moderation now also requires:

- `Test.body_json` must parse through `parseSpeakingContent()`, and
- the test must still have exactly three thin part-anchor rows in order:
  - `speaking-part-1` at position `0`
  - `speaking-part-2-cue` at position `1`
  - `speaking-part-3` at position `2`

This protects both the learner-facing review surface and the downstream
transcript/result flows that key on those anchors.

### D3 — Tighten the Speaking validator to match the prompt spec

`packages/ai/src/generation/speaking-validate.ts` now enforces the parts of the
prompt spec that were previously documented but not checked:

- `topic_domain` must be 2–5 words
- Part 1 must open with a home/work/study-style subtopic
- Part 2 follow-up prompts must be actual short questions
- Part 3 discussion prompts must be questions ending with `?`
- generator-side caller/model track mismatches now emit `track.mismatch`
  instead of a misleading generic prompt code

This keeps the validator aligned with `prompts/generation/speaking.md`.

### D4 — Review UI surfaces Speaking issue codes and blocks approval

The Speaking review page now surfaces stable validation issue codes when the
test is out of contract and disables approval while invalid, but rejection
remains available.

This keeps the UI behaviour aligned with the server-side approval rule rather
than relying on a looser page-only parser.

## Consequences

- Existing pending Speaking tests with malformed scripts, invalid Part 1
  openings, malformed Part 2 follow-ups, non-question-shaped Part 3 prompts,
  or missing/invalid part anchors must be fixed or rejected before approval.
- Future changes to the Speaking prompt contract should update:
  - `prompts/generation/speaking.md`
  - `packages/ai/src/generation/speaking-schema.ts`
  - `packages/ai/src/generation/speaking-validate.ts`
  - `apps/web/lib/speaking/review-validation.ts`

## Alternatives considered

- **Trust the reviewer and keep approval permissive.**
  Rejected. Human review still needs a mechanical guardrail for learner-visible
  IELTS format rules and runtime anchor integrity.

- **Validate only `body_json`, not the part anchors.**
  Rejected. Speaking runtime flows also depend on the three thin `Question`
  rows remaining intact.

- **Use only the page parser as the approval gate.**
  Rejected. The page parser is intentionally light-weight and looser than the
  canonical generation contract.
