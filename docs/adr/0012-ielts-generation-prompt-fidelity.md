# ADR 0012 — IELTS generation prompt fidelity guards

- Date: 2026-05-18
- Status: Accepted

## Context

By mid-May 2026 the generation prompts for Reading, Listening, Writing,
and Speaking were more IELTS-like than the semantic validators actually
enforced. That mismatch created two failure modes:

1. The model could follow a looser or contradictory branch of the prompt
   and still pass validation.
2. Future prompt edits could drift away from the canonical runner /
   moderation expectations because only one layer changed.

The concrete gaps were:

- Reading prompt text implied GT `gt_context` could be omitted, while the
  validator already required it.
- Listening claimed a real-IELTS-style 4-part scaffold but only enforced
  generic shape and grounding rules.
- Writing required canonical Task 1 / Task 2 wording and tighter Task 1
  visual ranges than the validator checked.
- Speaking required Part 3 to expand Part 2, but no machine check existed
  beyond question shape.

## Decision

We treat IELTS generation as a three-layer contract:

1. Prompt markdown teaches the canonical target.
2. Generator user-turn reminders repeat the highest-risk constraints.
3. Semantic validators reject outputs that break those constraints.

The layers must stay aligned.

### Reading

- GT generations must always include `passage.gt_context`.
- Prompt examples must not include JSON comments or tell the model the
  field may be omitted.
- User turns now remind the model about paragraph counts, question
  counts, contiguous positions, and GT `gt_context`.

### Listening

- Listening remains the shortened product form (20–32 questions total),
  but every section must still feel like IELTS:
  - exactly 4 parts
  - contexts fixed to social / social / academic / academic
  - 5–8 questions per part
  - scene-speaker counts fixed by part shape
  - narrator/preview/listen/end-of-part/reading-pause scaffold
  - at least 3 accents across the section
- `examiner` is invalid in Listening generations.
- Cleaner drops still run, but the validator now rejects sections if the
  cleaned result no longer satisfies the per-part / per-section contract.

### Writing

- Academic Task 1 must contain the canonical
  "Summarise the information ..." instruction, not just any mention of
  "main features".
- Task 2 must contain the full canonical
  "Give reasons for your answer and include any relevant examples ..."
  line.
- Academic Task 1 preambles are capped at 1–2 short sentences.
- Academic Task 1 visuals must stay inside the tighter IELTS-style ranges:
  bar/line 2–5 series and 3–7 categories, pie 3–6 slices, table 3–5
  columns and 3–8 rows, process 4–7 steps.

### Speaking

- Part 3 must stay in the same domain as Part 2.
- Validation uses a heuristic bridge:
  - direct topical overlap between Part 2 and Part 3 is acceptable
  - otherwise `topic_domain` must meaningfully bridge both
- This is intentionally heuristic, not a semantic classifier. The goal is
  to catch obvious topic switches, not reject normal paraphrase.

## Consequences

- Prompt edits now require a paired review of user-turn reminders and
  semantic validators.
- Some older or borderline generations that previously passed may now
  fail validation and require regeneration.
- Listening generations are stricter than before; a single dropped
  question can now invalidate a part if it falls below the 5-question
  floor.
- Future contributors should prefer adding explicit issue codes and tests
  when tightening IELTS fidelity rather than relying on prompt wording
  alone.
