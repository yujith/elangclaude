# ADR 0007 — Listening data shape: 4-part script on `Test.body_json`, 40 Question rows, deterministic grader

Status: Accepted
Date: 2026-05-16

## Context

Phase 1 of the Listening feature plan needs the data-model decisions written
down before any parser or schema work lands, for the same reason ADR 0003
(Reading) and ADR 0006 (Speaking) exist: once code references a shape, drift
becomes painful.

Listening is more like Speaking than Reading in structure (a multi-part
scripted recording where the whole thing is one cohesive unit), but more like
Reading in grading (deterministic, no LLM call on submit, 40 questions with
exact-match answer keys). The decisions below pick the parts of each pattern
that fit and call out where Listening genuinely differs.

The user-facing goal driving these decisions: be **as close to the real IELTS
Listening test as practical**. That means a single continuous 4-part section,
not a "Part 1 only" practice unit. Section practice = the full ~30-minute
Listening section; Full Mock Test chains that section with the other three.

## Decisions

### D1 — One `Test` = the full 4-part Listening section

A Listening `Test` (section = `Listening`) represents the whole ~30-minute
section: Part 1 (social, dialogue), Part 2 (social, monologue), Part 3
(academic, 2–4 speakers), Part 4 (academic monologue/lecture). The 4 parts
share one audio asset in the real exam — they are not independently graded
units. Modelling them as separate `Test` rows would force every learner-facing
surface (picker, runner, results page, mock-test composer) to re-assemble the
four parts back into one logical section.

This is the Speaking pattern (ADR 0006 D1), not the Reading pattern (1 Test =
1 passage). Reading passages are independent practice units in real IELTS too
(the exam has three, but a learner practising one of them is meaningful in
isolation). A single Listening part out of context is not — the difficulty
ramp across parts 1→4 is the point.

Consequence: there is no "Listening Part 1 practice" surface in v1. If
learners ask for one later, it lands as a generation-side tag plus a picker
filter, not a different data shape.

### D2 — The 4-part script lives on `Test.body_json`; 40 thin Question rows hang off

`Test.body_json` carries the full structured script, parsed by
`packages/ai/src/listening/content.ts` into a `ListeningContent` value:

```ts
type ListeningContent = {
  schema_version: 1;
  parts: ListeningPart[];          // length 4, ordered 1..4
};

type ListeningPart = {
  part: 1 | 2 | 3 | 4;
  context: "social" | "academic";  // parts 1+2 social, 3+4 academic
  title: string;
  speakers: ListeningSpeaker[];
  transcript: ListeningSegment[];
  audio_asset?: ListeningAudioAsset;   // null in Phase 1; Phase 2 fills it
  question_positions: number[];        // Question.position values in this part
  completion_blocks?: CompletionBlock[]; // form/notes/table/etc. layout containers
};

type ListeningSpeaker = {
  id: string;                            // stable, referenced by speech segments
  name: string;                          // "Receptionist", "Tom", "Lecturer Williams"
  role: "narrator" | "examiner" | "speaker";
  accent: "british" | "american" | "australian" | "canadian" | "new-zealand";
  voice_id?: string;                     // filled at TTS synth time (Phase 2)
};

type ListeningSegment =
  | { kind: "narration"; text: string }                          // "Now turn to Part 1."
  | { kind: "speech"; speaker_id: string; text: string }
  | { kind: "reading-pause"; seconds: number; instruction?: string }
  | { kind: "questions-preview"; seconds: number; question_positions: number[] };

type ListeningAudioAsset = {
  storage_key: string;     // R2 key, e.g. "audio/{sha256}.mp3" — global, not org-scoped
  duration_sec: number;
  sha256: string;
  format: "mp3" | "wav" | "ogg";
};
```

The 40 (or fewer, during ramp-up) `Question` rows are **thin**: the
human-readable `prompt`, a `type` literal from
`packages/ai/src/listening/question-types.ts`, and the answer-key JSON in
`correct_answer`. Each row's `Question.position` is its global index 0..39
across the whole section; `ListeningPart.question_positions` is the canonical
grouping that says which positions belong to which part.

Why `body_json` and not splitting the script across the Question rows:
- Speakers, transcript flow, reading-pause cues and the audio asset are
  *above* the per-question level. Owning them on `Test` keeps every question
  row uniformly question-shaped (same precedent as Reading's passage in ADR
  0003 D1 and Speaking's 3-part script in ADR 0006 D1).
- The strict single-play player needs the whole timed script (the inter-part
  narration, the reading-ahead pauses) to drive the audio + UI. Re-assembling
  that from 40 Question rows would force every render path to special-case
  ordering and timing.
- `body_json` is already a nullable, section-owned column. Writing leaves it
  null; Reading parses it as a passage; Speaking parses it as a 3-part script;
  Listening parses it as a 4-part script. One column, four parsers, no
  conflict.

No schema migration is required: `Section.Listening` and `Test.body_json` are
already part of the canonical schema.

### D3 — Reuse Reading's `CompletionBlock` shape, add a `"form"` layout

Form completion is the Part 1 staple ("Name: ___ / Phone: ___"). Note,
table, flow-chart, summary completion appear across Parts 2–4. All five
share the same underlying shape Reading already defined: a typed container
with rows of cells, each cell a `(text|blank)` segment list, slot ids
globally unique within the test (`packages/ai/src/reading/passage.ts:62`).

Decision: Listening defines its own `CompletionBlock` type that is structurally
identical to Reading's, with the layout union widened to include `"form"`:

```ts
type ListeningCompletionLayout =
  | "form" | "notes" | "table" | "flow-chart" | "summary" | "diagram";
```

Why a separate type and not a shared one:
- Reading's `CompletionLayout` is a sealed union shipped to the Reading
  renderer. Extending it to include `"form"` would either leak a
  Listening-only layout into Reading or force a backward-incompatible rename.
- The parsers are simple enough (~80 lines) that duplication is cheaper than
  the cross-package coupling a shared `@elc/ai/completion` module would add.
- If a third caller ever needs the shape, lifting it into a shared helper is
  a one-day refactor with full test coverage.

A `listening-completion-blank` question references `(block_id, slot_id,
word_limit, accepted)`. The renderer reads the `layout` off the block to
decide how to display the slot (a row in a form, a cell in a table, a step
in a flow chart, a labelled point on a diagram).

### D4 — Phase 1 ships 5 question kinds; matching and plan/map/diagram land later

Phase 1 locks the data shape and the deterministic-grading patterns. It
deliberately ships a narrow set of question kinds so the contract is well-
exercised before broadening:

- `listening-mcq-single` — one correct option.
- `listening-mcq-multi` — N correct options; learner picks ≥ N from M.
- `listening-sentence-completion` — same mechanics as Reading.
- `listening-short-answer` — same.
- `listening-completion-blank` — references a `CompletionBlock` slot; the
  layout (form / notes / table / flow-chart / summary / diagram) is on the
  block, not the question.

Out of Phase 1 (land in later phases with their own parsers):
- `listening-matching` — learner matches a list of items to a bank of
  options. Mechanically identical to Reading's matching-features but with
  Listening-specific banks.
- `listening-plan-map-diagram-label` — visual asset + labelled-point bank.
  Needs an image storage decision (R2 keys, signed URLs, alt-text contract)
  that is its own design call, not a Phase 1 lockdown.

Including them in the Phase 1 type union as stubs would create trap doors
(parsers returning `null` for kinds that exist in storage) — better to keep
the union tight and grow it deliberately.

### D5 — Audio assets are content, not tenancy data — global R2 keys

Listening audio is shared content like the `Test`/`Question` rows themselves:
once a Test is approved and synthesised, every learner across every org plays
the same bytes. The R2 key for an audio asset is therefore **global, not
`org_id`-scoped**: `audio/{sha256}.mp3` (see Phase 2 storage work).

The *signed URL minter* is still org-scoped — only a learner with a valid
in-flight `Attempt` for the parent `Test` gets a URL — but the underlying
object key carries no tenancy. This is the same model as Test/Question rows,
which are also not tenant-scoped (`packages/db/prisma/schema.prisma:72`).

This decision is restated here so the Phase 2 storage work has a written
anchor; it does not change anything in Phase 1.

### D6 — Deterministic grader, output shape parallels `ReadingGrade`

No LLM call on submit. The grader composes per-question normalisation
(reusing Reading's `normalize.ts` for sentence/short-answer completion and
MCQ) with a Listening-specific raw→band table (`band.ts`, lands in Phase 4).
Output is written to `Grade.criteria_scores_json` as a `ListeningGrade`
parallel in shape to `ReadingGrade` (`schema_version`, `section`, `track`,
`raw_correct`, `raw_total`, `band_overall`, `breakdown[]`).

The band table is *not* the Reading table. IELTS publishes a separate
Listening conversion that is more lenient at the top end; sourcing it is
Phase 4 work.

## Consequences

- `packages/ai/src/listening/{content,question-types,fixtures}.ts` land in
  Phase 1, tested via Vitest. No `apps/web` work yet.
- Phase 2 (TTS + audio cache) populates `ListeningPart.audio_asset` at
  SuperAdmin-approval time and writes objects under the global `audio/`
  prefix in R2.
- Phase 3 (generation) writes the same `ListeningContent` shape but
  without `audio_asset` populated — the generated row lands as
  `PendingReview` and only acquires audio on approve.
- Phase 4 (runner + grader) reads `body_json` via the parser, refuses to
  start an attempt if the parse returns `null`, and writes
  `ListeningGrade` to `Grade.criteria_scores_json`.
- The results page branches on `Attempt.section` — Writing reads
  `writingGradeSchema`, Reading reads `readingGradeSchema`, Listening reads
  a new `listeningGradeSchema`.
- The mock-test composer (Phase 6) treats Listening as one section / one
  attempt — no special-casing of parts at the composer level.

## Alternatives considered

- **One `Test` per Part (1 Listening section = 4 Tests).** Rejected — see
  D1. Splits a logically-single 30-minute section across four storage rows
  and forces every learner-facing surface to re-assemble.
- **Question rows hold per-part script fragments.** Rejected — same
  category error as the rejected alternatives in ADR 0003 and ADR 0006.
- **Share `CompletionBlock` between Reading and Listening.** Rejected
  initially — see D3. Trivially refactorable later if a third caller
  appears.
- **Ship all 11 IELTS Listening question types in Phase 1.** Rejected — see
  D4. Locks in shapes for `matching` and `plan-map-diagram-label` before
  the visual-asset / bank-storage decisions are made.
- **Store audio under `audio/{org_id}/...`.** Rejected — see D5. Audio is
  shared content, not tenant data; per-org prefixes would multiply storage
  cost by the number of orgs.
