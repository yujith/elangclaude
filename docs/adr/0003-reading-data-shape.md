# ADR 0003 — Reading data shape: passage payload on `Test`, deterministic grader, raw + band on results

Status: Accepted
Date: 2026-05-11

## Context

Phase 1 of the Reading feature plan needs three decisions written down before any
schema change lands, because they are easy to drift on once code is written:

1. **Where does the passage live?** Reading is a 1-passage, N-question section.
   The existing `Test → Question` shape lets us model the passage either as a
   dedicated payload on `Test` (e.g. a `body_json` column) or as a "passage"
   `Question` row at `position = 0`.
2. **How are short-answer–style responses normalised?** "no more than 3 words"
   needs a written contract — without one, three sprints from now we'll have
   three different rules across three question types.
3. **What does the learner see at the end of a Reading attempt?** The brief
   says auto-graded; the IELTS domain skill says band 0–9 in half-band
   increments. The Reading-specific 0–40 raw-to-band conversion table is the
   missing piece.

## Decisions

### D1 — Passage lives on `Test.body_json`

Add a nullable `body_json Json?` column to `Test`. The Reading parser owns its
shape; Writing rows leave it null.

Why a column on `Test` rather than a "passage" `Question`:

- Multiple question types (matching headings, matching information, sentence
  completion) all need paragraph-level addressing (`paragraph A`, `paragraph
  B`, …). Owning that addressing on the `Test` row means every `Question`
  reads it from a single source.
- A "passage `Question`" would force every question-rendering path to special-
  case `position = 0`. `Test.body_json` keeps `Question` rows uniformly
  question-shaped.
- Writing already uses `Question.visual` for its chart/process payload; mixing
  in a passage-shaped payload on the same column would be a category error.
- The column is nullable and additive — no back-compat work for Writing.

The shape (parsed in `packages/ai/src/reading/passage.ts`):

```ts
type ReadingPassage = {
  title?: string;
  // Each paragraph is labelled A, B, C, … in display order. The label is
  // canonical — matching-question correct_answers reference it.
  paragraphs: { label: string; text: string }[];
  word_count?: number;
};
```

Validation is hand-written (no Zod dep added to `apps/web`), matching the
`parseVisual` pattern in `apps/web/lib/writing/visual.ts`. A malformed row
returns `null` and the runner refuses to start the attempt rather than render
half-broken UI.

### D2 — Answer-normalisation contract lives at `prompts/grading/reading-normalization.md`

Reading grading is deterministic, but "deterministic" only holds if the rules
for "is this answer equivalent to the key" are written down. Phase 1 commits a
first cut covering the three question types we ship:

- Case-insensitive equality after Unicode NFKC + whitespace collapse.
- Leading articles (`a`, `an`, `the`) are stripped before comparison for
  sentence-completion / short-answer.
- Word-limit rules (`"no more than 3 words"`) are enforced — over-limit answers
  are graded incorrect even if the stem text matches.
- TFNG / YNNG accept the three labels case-insensitively, no other strings.
- MCQ stores the option's stable `id` ("A", "B", …) — no string-matching at
  all.

Future phases extend the file as new question types arrive. The file is the
single contract; the implementation lives at `packages/ai/src/reading/
normalize.ts` with unit tests against the rules.

### D3 — Results page shows raw + IELTS Academic band-equivalent

Learners see two numbers:

- `Raw 27 / 40` — the count of correct answers across all questions on the
  attempt. Maps to a concrete sense of "how many did I get right."
- `Band ≈ 6.5` — IELTS Academic raw-to-band conversion table, the published
  one IDP/BC use. We surface Academic mapping in v1; the GT mapping is a
  separate table that lands when the GT picker ships, because the same raw
  score maps to different bands across the two tracks (GT is harder).

The band is rendered as "approximate" — a single 13-question passage is a
*practice unit*, not a full 40-question section, so the conversion is a
calibration cue, not an examiner-equivalent score. Communicated in the UI
copy.

## Consequences

- A Prisma migration adds `Test.body_json Json?` (Phase 1).
- `packages/ai/src/reading/*` becomes the home for Reading domain logic
  (passage parser, question-type parsers, normaliser, grader). Tests run via
  the existing `pnpm -r test` setup with no new test runner in `apps/web`.
- The learner Results page branches by `Attempt.section` — Writing reads the
  existing `writingGradeSchema`; Reading reads a new `readingGradeSchema`. The
  branch is in one place and named.
- Phase 3 (matching question types) and Phase 4 (completion + short-answer)
  extend the normalisation spec rather than re-deciding it.
- The GT-specific raw-to-band table is a follow-up; the picker is currently
  Academic-friendly only.

## Alternatives considered

- **Passage as a `Question` row at `position = 0`** — rejected (see D1).
- **Inline normalisation rules in each renderer** — rejected. Drifts within
  three question types.
- **Show only the band, hide the raw count** — rejected. A learner who got 6
  out of 13 right shouldn't see "Band 4.5" with no count; the count is what
  they can act on next attempt.
