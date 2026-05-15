# ADR 0006 — Speaking data shape: 3-part content on `Test.body_json`, thin Question anchors

Status: Accepted
Date: 2026-05-15

## Context

Phase 1 of the Speaking feature plan generates IELTS Speaking content and
needs three decisions written down before code lands, because — like the
Reading data shape (ADR 0003) — they are easy to drift on once code exists:

1. **What is a "Speaking test"?** A Speaking test is the full ~12-minute
   examiner script: Part 1 (interview on familiar topics), Part 2 (a cue card
   for the 1–2 min long turn), Part 3 (abstract discussion). It is not a
   question-per-row section like Reading.
2. **Where does that 3-part content live** in the existing `Test → Question`
   shape?
3. **Does Speaking content vary by track?** The schema requires `Test.track`,
   and the Reading/Writing pickers filter by it.

## Decisions

### D1 — The 3-part content lives on `Test.body_json`; Question rows are thin anchors

A Speaking `Test` (section = `Speaking`) carries the whole structured script
on `Test.body_json`:

```ts
type SpeakingContent = {
  topic_domain: string;            // overall thematic domain
  part1: { theme: string; subtopics: { topic: string; questions: string[] }[] };
  part2: {
    cue_card_topic: string;        // "Describe a book you recently read."
    bullets: string[];             // the "You should say:" points
    final_prompt: string;          // "and explain why you found it memorable."
    followup_questions: string[];  // 1–2 short rounding-off questions
  };
  part3: { theme: string; questions: string[] };
};
```

It also gets **exactly 3 `Question` rows** — `type` of `speaking-part-1`,
`speaking-part-2-cue`, `speaking-part-3`, at `position` 0/1/2. These rows are
**thin anchors**: a short human-readable `prompt` label, no `correct_answer`,
no `visual`. They exist so the Phase 3 transcript pipeline has a `Question` to
hang each part's `Answer` row on (`Answer.question_id` is required).

Why `body_json` and not the Question rows:

- This is exactly the ADR 0003 D1 reasoning for Reading's passage. The whole
  test has structure *above* the per-part level (the 3 parts, their themes,
  the cue card). Owning that on the `Test` row means one parse, one source.
- The Phase 2 realtime examiner is driven by the *whole* script at once — it
  needs Part 1 + the cue card + Part 3 to build the session instructions. A
  per-Question split would force it to re-assemble the script from 3 rows.
- `Question` rows stay uniformly thin and never need a 4th payload column.
- `body_json` is already a nullable, section-owned column. Reading parses it
  one way, Speaking another — no conflict, the parser only runs for its
  section. Same precedent as `Question.visual` being Writing-only.

No schema migration: `Section.Speaking`, `Test.body_json`, and the 3
`Question` rows all fit the current schema.

### D2 — Content is validated twice: Zod in `@elc/ai`, hand-rolled in `apps/web`

Mirroring Writing (`writing-schema.ts` Zod + `apps/web/lib/writing/visual.ts`
hand-rolled): the generation pipeline validates the model's output with a Zod
schema (`packages/ai/src/generation/speaking-schema.ts`); the web app
validates what it reads back from `Test.body_json` with a hand-written parser
(`apps/web/lib/speaking/content.ts`) that returns `SpeakingContent | null`. A
malformed row returns `null` and the surface refuses to render it rather than
crash. Per ADR 0003 D1, no Zod dependency is added to `apps/web`.

### D3 — Speaking content is track-agnostic; `Test.track` is a catalog tag only

Real IELTS Speaking is identical for Academic and General Training — only
Reading, Writing, and Listening differ. But `Test.track` is a required column.

Decision: Speaking generation takes a `track` input (one dropdown, consistent
with `writing-task-2` requiring an explicit track) and tags the `Test` row
with it, but **the generation prompt does not branch on track** — the content
is the same either way. Consequence for Phase 2: the learner Speaking picker
**does not filter by track** (unlike Reading/Writing) — every approved
Speaking test is offered to every learner. The `track` tag is retained only
for catalog consistency and SuperAdmin filtering.

### D4 — Moderation is approve/reject only — no inline content edit

Writing moderation added `editWritingPrompt` because a Writing task is one
wordy prose block a reviewer naturally wants to tweak. Speaking content is a
structured 3-part object; a meaningful inline editor is a real form, not a
textarea. v1 mirrors **Reading** instead: the SuperAdmin approves or rejects;
bad content is rejected and regenerated. An inline editor is a later
follow-up if reviewers find regeneration too blunt.

## Consequences

- `packages/ai/src/generation/speaking-schema.ts`, `speaking-validate.ts`,
  `speaking.ts`, `speaking-persist.ts` land — mirroring the `writing-*`
  generation modules.
- `packages/ai/src/generation/prompts.ts` gains `"speaking"` as a
  `GenerationKind`; `prompts/generation/speaking.md` is the canonical prompt.
- `speaking-cue-generate` is already activated on the OpenRouter cheap tier
  (ADR 0005, D5).
- `apps/web/lib/speaking/content.ts` is the read-side parser + render helpers
  (canonical cue-card rendering), shared by Phase 1 moderation and the Phase 2
  runner.
- `apps/web/app/(super)/content/speaking/` gets the moderation queue + review
  pages; `lib/speaking/generate-actions.ts` + `moderation-actions.ts` mirror
  the Writing equivalents (minus the edit action).
- Generated Speaking tests land as `PendingReview` and cannot reach a learner
  until a SuperAdmin approves — the same correctness backstop as ADR 0004 D6.

## Alternatives considered

- **One `Question` row per Part 1 sub-question / Part 3 question.** Rejected —
  it explodes a single test into ~20 rows, none of which the realtime examiner
  consumes individually, and it still needs a home for the cue card structure.
- **Cue card on `Question.visual`.** Rejected — `visual` is the Writing chart
  payload; overloading it for Speaking is the category error ADR 0003 warned
  about.
- **Generate a separate Speaking test per track.** Rejected — it doubles the
  content pool and the SuperAdmin moderation load for content that is, by
  definition, identical.
- **Add `Question.body_json`.** Rejected — a migration for something
  `Test.body_json` already does.
