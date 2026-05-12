---
spec: reading-answer-normalization
version: 3
phase: 4
question_types:
  - mcq
  - true-false-not-given
  - yes-no-not-given
  - sentence-completion
  - matching-headings
  - matching-information
  - matching-features
  - matching-sentence-endings
  - short-answer
  - completion-blank
---

# Reading — Answer normalisation contract (Phase 1)

This file is the contract for "is the learner's answer correct" on Reading
attempts. Reading is deterministically graded (no AI on submit) — so the
rules must be written down or three sprints from now we'll have three
different ones.

Implementation: `packages/ai/src/reading/normalize.ts`.
Tests live alongside it and assert against the rules below.

## Universal rules

Applied before any question-type-specific check:

1. **Unicode normalisation** — `NFKC` so visually-equal strings compare equal
   (curly quotes, full-width digits, accented characters, ligatures).
2. **Whitespace collapse** — all whitespace runs become a single ASCII space.
   Leading and trailing whitespace are trimmed.
3. **Case-folding** — `toLocaleLowerCase("en")` after the above.

These three together are "soft-normalise." Question-type rules below apply on
top of soft-normalised input.

## Per-type rules

### `mcq` (Multiple Choice)

- The correct answer is stored as an option `id` (a stable letter `"A"`,
  `"B"`, …), never as the option text.
- The learner's submitted answer is also an option `id`. Comparison is a
  literal string equality on the soft-normalised id (so `"a"` matches
  `"A"`).
- A missing answer is graded incorrect (not skipped).

### `true-false-not-given` and `yes-no-not-given`

- Accepted labels are exactly: `"true" | "false" | "not given"` for TFNG and
  `"yes" | "no" | "not given"` for YNNG, case-insensitive after soft-
  normalise.
- Anything else — including `"T" / "F" / "NG"` shorthand — is graded
  incorrect. The UI is responsible for only ever submitting the long labels.
- A missing answer is graded incorrect.

### `sentence-completion`

- The correct answer is stored as an array of one or more accepted strings.
  The learner's answer matches if it equals any one of them after the rules
  below.
- **Leading article strip** — after soft-normalise, a leading `a `, `an `, or
  `the ` is removed from BOTH the learner answer and each accepted key
  before comparison. This makes `"modern computer"` and `"the modern
  computer"` equivalent.
- **Word limit** — the question specifies a maximum (`"no more than three
  words"` → 3). Word count is computed on the soft-normalised + article-
  stripped learner answer (splitting on the single ASCII space). If the
  count exceeds the limit, the answer is graded incorrect even if its prefix
  would have matched a key. This is the IELTS rule and is non-negotiable.
- **Hyphenated compounds** — a hyphenated token (`"sun-light"`) counts as
  **one** word for the limit check. The learner's exact form is preserved
  for the comparison, but normalisation collapses `"sun- light"` → `"sun-
  light"` first.
- **Punctuation** — trailing punctuation (`. , ; : ! ?`) on the learner
  answer is stripped before comparison. Interior punctuation is preserved.
- **Numbers** — digit and word forms are NOT equivalent. `"three"` does not
  match `"3"`. Question authors must include both in the accepted-keys
  array if both should pass.
- **Spelling tolerance** — none in Phase 1. Misspellings are incorrect. (A
  Levenshtein-1 tolerance is an explicit follow-up question and won't ship
  here.)
- A missing answer is graded incorrect.

## Worked examples

| Question type | Key | Learner | Graded |
|---|---|---|---|
| `mcq` | `"B"` | `"b"` | correct (case-fold) |
| `mcq` | `"B"` | `""` | incorrect (missing) |
| `tfng` | `"not given"` | `"Not Given"` | correct |
| `tfng` | `"true"` | `"T"` | incorrect (shorthand banned) |
| `sentence-completion` (limit 2) | `["modern computer"]` | `"the modern computer"` | correct (article stripped) |
| `sentence-completion` (limit 2) | `["modern computer"]` | `"a modern computer"` | correct (article stripped) |
| `sentence-completion` (limit 2) | `["modern computer"]` | `"a very modern computer"` | incorrect (3 words after strip) |
| `sentence-completion` (limit 3) | `["sun-light"]` | `"Sunlight"` | incorrect (different token) |
| `sentence-completion` (limit 3) | `["sun-light"]` | `"sun-light."` | correct (trailing punct stripped) |
| `sentence-completion` (limit 3) | `["three"]` | `"3"` | incorrect (digit ≠ word) |

## Matching-type rules (Phase 3)

All four matching types share the same "pick a key from a bank" mechanic.
The bank lives on the passage payload (or, for matching-information, is the
list of paragraph labels in the passage). The learner picks one bank key
per question; the grader compares keys, never bank-item text.

### `matching-headings`

- Bank: a list of headings, each with a stable key (Roman numerals
  `i, ii, iii, …` per IELTS convention, but any stable string is fine).
- Each question targets one paragraph in the passage and asks the learner
  to pick the matching heading key.
- Correct answer = bank key. Comparison is soft-normalised string equality.
- IELTS convention: each heading is used at most once. We do **not**
  enforce this at the grader level (a learner who reuses a heading just
  gets one question right and another wrong). The UI is free to surface a
  warning, but the grader is per-question.
- A missing answer is incorrect.

### `matching-information`

- The "bank" is the passage's paragraph labels (`A, B, C, …`) — no
  separate group on the passage payload is required.
- Correct answer = paragraph label. Comparison is soft-normalised string
  equality (so `"a"` matches `"A"`).
- Same paragraph may match several questions; this is normal for the type.
- A missing answer is incorrect.

### `matching-features`

- Bank: a list of features/entities (e.g. researchers, locations,
  categories), each with a stable key.
- Each question is a claim/finding; the learner picks the feature it
  belongs to.
- `allow_reuse` flag on the bank: when `true`, the same bank key may be
  the correct answer for multiple questions (IELTS sometimes writes "NB
  You may use any letter more than once"). The grader is per-question
  regardless — `allow_reuse` is for the UI to surface the instruction.
- Correct answer = bank key. Comparison is soft-normalised string equality.
- A missing answer is incorrect.

### `matching-sentence-endings`

- Bank: a list of candidate sentence endings, each with a stable key
  (IELTS uses `A, B, C, …`).
- Each question is a sentence start; the learner picks the ending that
  completes it best per the passage.
- IELTS convention: bank has more endings than starts, so some are decoys
  and each ending is used at most once. As with headings, we don't enforce
  one-time use in the grader.
- Correct answer = bank key. Comparison is soft-normalised string equality.
- A missing answer is incorrect.

### Worked examples (matching types)

| Question type | Bank | Correct key | Learner | Graded |
|---|---|---|---|---|
| `matching-headings` | `{i, ii, iii, iv}` | `"iii"` | `"iii"` | correct |
| `matching-headings` | `{i, ii, iii, iv}` | `"iii"` | `"III"` | correct (soft-fold) |
| `matching-headings` | `{i, ii, iii, iv}` | `"iii"` | `""` | incorrect (missing) |
| `matching-information` | passage `{A, B, C, D}` | `"B"` | `"b"` | correct |
| `matching-features` | `{R1, R2, R3}` | `"R2"` | `"R3"` | incorrect |
| `matching-sentence-endings` | `{A, B, C, D, E}` | `"D"` | `"D"` | correct |

## Short-answer + completion-blank rules (Phase 4)

These two kinds round out every IELTS Reading question type. Their answer
mechanics are identical to `sentence-completion`; what's new is the
*context* the question appears in.

### `short-answer`

- The question prompt **is** the question (no inline `___` blank). The
  learner types a free-text answer.
- Correct answer storage = `accepted: string[]` + `word_limit: number`,
  identical to `sentence-completion`.
- All `sentence-completion` rules apply unchanged: soft-normalise, trailing
  punctuation strip, leading-article strip, word-limit enforcement,
  hyphenated tokens count as one word, digits ≠ words, no spelling
  tolerance, missing = incorrect.

### `completion-blank`

- The passage payload may carry one or more **completion blocks** under
  `body_json.completion_blocks`. Each block has a `layout` (`summary` |
  `notes` | `table` | `flow-chart` | `diagram`), a `title?`, and `rows` of
  cells where each cell is a sequence of `text` and `blank` segments.
  Each `blank` carries a stable `slot_id`.
- A `completion-blank` question references one block by `block_id` and one
  slot inside it by `slot_id`. The correct-answer storage =
  `accepted: string[]` + `word_limit: number`, same as `sentence-completion`.
- Grading is identical to `sentence-completion`: soft-normalise + strip
  + word-limit + accepted-keys match.
- The block-id/slot-id pair is also the unit of association between
  questions in the same block — the runner groups consecutive questions
  pointing at the same block under one rendered block, with their blank
  inputs inline.

### Worked examples (Phase 4)

| Question type | Word limit | Key | Learner | Graded |
|---|---|---|---|---|
| `short-answer` | 3 | `["a clay tablet"]` | `"A Clay Tablet"` | correct |
| `short-answer` | 3 | `["a clay tablet"]` | `"a clay tablet from Sumer"` | incorrect (5 words after article strip) |
| `completion-blank` (summary) | 2 | `["1843"]` | `"1843."` | correct (trailing punct strip) |
| `completion-blank` (table) | 1 | `["wood"]` | `"timber"` | incorrect (no synonym tolerance) |
| `completion-blank` (notes) | 2 | `["fifteen days"]` | `"15 days"` | incorrect (digit ≠ word) |

## What this file does NOT cover yet

These extend the spec in later phases and are intentionally out of Phase 4
scope:

- Summary completion **with a word bank** — semantically `matching-features`
  rendered inline in a summary block. Not shipped here; Phase 6 polish.
- Diagram-label completion against a real image with coordinate-anchored
  labels. Phase 4 renders diagrams as labelled callouts, not pixel-anchored
  overlays.
- Number / unit handling for completion-style answers ("80%" vs "80 percent"
  vs "eighty percent").
- Spelling tolerance.
- "Heading reused" warnings in the UI (the rule is one-time-use per IELTS
  but the grader is per-question; surfacing the warning is a Phase 6 polish).

When those phases land, they extend this file in the same PR that adds the
renderer + grader code. The file version number bumps.
