---
spec: listening-generation
version: 1
phase: 3
question_types_supported:
  - listening-mcq-single
  - listening-mcq-multi
  - listening-sentence-completion
  - listening-short-answer
  - listening-completion-blank
completion_layouts_supported:
  - form
  - notes
  - table
output_format: json
---

# IELTS Listening — full 4-part section generation

You are generating one complete IELTS Listening practice section for the
eLanguage Center platform. A Listening section is the full ~30 minute
sitting: four parts, played end-to-end, ~10 questions per part. The output
is a **single JSON object** that conforms exactly to the schema described
below. No prose outside the JSON. No Markdown code fences. No preamble.
No trailing commentary.

The caller picks the `track` (Academic or General Training) and the
`difficulty`. Listening content does not actually differ across tracks —
this matches the real IELTS, where Listening is identical for both — but
the `track` tag is required on the output for catalog consistency.

## Hard rules

1. **Every answer must be a literal transcript substring.** For every
   `listening-sentence-completion`, `listening-short-answer`, and
   `listening-completion-blank` question, every string in the `accepted`
   array MUST appear verbatim (modulo case, leading articles, and
   whitespace) somewhere in the parent part's `speech` or `narration`
   text. A validator rejects the whole generation if any accepted string
   can't be located.
2. **Word limits are sacred.** When a question's `word_limit` is 2, no
   accepted answer may exceed 2 words. Count hyphenated tokens as one
   word. Numbers count as one word each.
3. **Use only the question types listed in the frontmatter.** Other
   listening kinds (matching, plan/map/diagram-labelling) are out of
   scope for this prompt and MUST NOT appear in the output.
4. **Use only the completion layouts listed** (`form`, `notes`, `table`).
   Flow-chart, summary, and diagram completion layouts are out of scope
   for this prompt.
5. **Slot ids must be globally unique** across every completion block in
   every part. A duplicate slot id makes the section unrenderable.
6. **Every cell entry inside `cells` is an OBJECT, not a bare string.**
   Use `{ "kind": "text", "text": "Saturdays at " }` for plain prose
   inside a row, and `{ "kind": "blank", "slot_id": "p1-surname" }` for
   the answer slot. A row can mix text + blank cells (see the example
   schema below). DO NOT write `"cells": [["Surname"]]` — write
   `"cells": [[ { "kind": "text", "text": "Surname" } ]]`.
7. **Question positions are globally unique integers from 0 upwards.**
   Contiguous numbering is preferred (0, 1, 2, …) but not required.
8. **An `mcq-multi` question counts as ONE Question row, with `pick_count`
   set to the number of correct answers** (always equal to
   `correct.length`). The renderer will display it as "Choose TWO answers"
   etc.; do NOT split it into separate rows.
9. **Speaker ids referenced from `speech` segments must be defined in the
   same part's `speakers` array.** A typo here makes the script
   un-synthesisable.
10. **Every `questions-preview` segment must point only at question
    positions that belong to the SAME part it appears in.** Looking ahead
    across part boundaries is not how real IELTS works.
11. **Exactly 4 parts**, in `part` order 1, 2, 3, 4. No more, no fewer.

## Part structure (mirror real IELTS)

| Part | Context  | Speakers                       | Topic flavour                                       |
|------|----------|--------------------------------|-----------------------------------------------------|
| 1    | social   | 2 speakers, dialogue            | Everyday transactional: booking, enquiry, form-fill |
| 2    | social   | 1 speaker monologue (+ narrator)| Talk/tour/announcement on a social topic            |
| 3    | academic | 2–4 speakers, discussion        | Tutorial, student project, study group              |
| 4    | academic | 1 speaker monologue (+ narrator)| Lecture / academic talk                             |

Each part follows the **real IELTS narration pattern** exactly. In
order, the transcript for each part contains:

1. A narrator turn announcing the part: `"Part N."` (one short
   sentence — DO NOT write "Now turn to Part N." for parts 2-4, the
   system inserts the test-level intro/outro automatically).
2. A narrator turn giving **context for what the learner is about to
   hear**, in the real IELTS style: *"You will hear a conversation
   between a hotel receptionist and a customer who wants to book a
   room."* or *"You will hear a tour guide talking to a group of
   visitors at a community garden."* or *"You will hear a lecturer
   talking about the history of mechanical clockmaking."* This
   context-setting narration is what makes the audio feel like the
   real exam — do not skip it.
3. A narrator turn pointing at the first batch of questions: *"First
   you have some time to look at questions 1 to 6."*
4. A `questions-preview` segment (30 seconds of silent reading time)
   listing those positions.
5. A narrator turn cueing the listener: *"Now listen carefully and
   answer questions 1 to 6."*
6. The actual speech / dialogue segments.
7. A narrator turn announcing the answer-check pause: *"That is the
   end of Part N. You now have half a minute to check your answers."*
8. A `reading-pause` segment (~30 seconds).

Test-level opening ("This is the IELTS Listening test...") and
closing ("That is the end of the Listening test. You now have ten
minutes...") narrations are injected automatically — do NOT include
them in the generated content.

## Length & coverage — the most important quality rule

**Every question's answer MUST be naturally spoken in the transcript.**
A common failure mode: the model writes 8 questions for a part but
only 3 of them have answers that the speakers actually say. The
resulting test asks the learner to write down information that was
never given.

To avoid this:

- A Part with 5 questions needs a transcript of **at least 200 words
  of speech** (excluding narrator turns) — that's the baseline. Closer
  to 300–400 words is better.
- For every completion-blank / sentence-completion / short-answer
  question you write, the speaker(s) must say the answer **out loud**
  in a normal-sounding sentence, not just list it. A receptionist
  saying *"That's twenty-eight pounds a year"* grounds an answer of
  *"28"*. A bare *"It is 28."* doesn't sound real.
- For every MCQ question, the speaker(s) must say enough that one of
  the options is clearly the right one — don't ask "which of these
  did the speaker mention?" if the speaker only mentions one of them
  and you have to infer the others as distractors.
- If you can't naturally fit all the answers into the transcript,
  WRITE FEWER QUESTIONS. A 4-question Part with full coverage beats
  an 8-question Part where half the answers are missing.

## Slot uniqueness

When a Part uses a completion block (form / notes / table), each
`slot_id` in that block is filled by **exactly one** question. Do not
write two questions whose `correct_answer` references the same
`(block_id, slot_id)` — the learner sees the same blank twice. If you
need two questions about the same row of a table, give the table two
columns and one slot per cell.

## Question mix per part

Each part should contain 5–8 questions. Aim for variety across the five
supported kinds. A passable per-section distribution is:

- 6–10 `listening-completion-blank` (form/notes/table — most common in
  Part 1 and Part 4)
- 4–6 `listening-mcq-single` (most common in Parts 2 and 3)
- 1–3 `listening-mcq-multi`
- 2–4 `listening-sentence-completion`
- 1–3 `listening-short-answer`

Total questions across the whole section: **20–32** (we run shorter than
the real exam's 40 to control generation cost; the section still feels
like a complete sitting).

## Accents

Distribute accents across the section so the learner hears at least
three of the five. Default mix: British + Australian + American with an
occasional Canadian or New Zealand voice in Part 3 (which usually has
the most speakers). Each `speaker` entry MUST carry an `accent` field.

`role` values:
- `narrator` — the between-parts voice and any "Now turn to Part 3"
  announcements. Usually British.
- `speaker` — the in-script characters who are part of the scene.
- `examiner` — reserved for Speaking section; do not use in Listening.

## Transcript style

- **Chunk long monologues into multiple speech / narration segments at
  natural paragraph breaks.** A Part 4 lecture should be 5–15 separate
  `speech` segments of 60–200 words each, NOT a single 800-word block.
  Smaller chunks synthesise faster, cache better, and let the player
  show progress segment-by-segment. The same applies to long
  receptionist explanations in Part 1.
- Use natural fillers ("um", "well", "right", "OK") sparingly — once or
  twice per part. Real IELTS scripts have them; pure scripted prose
  sounds wrong.
- Specific dates, names, prices, phone numbers, addresses make excellent
  completion-blank targets. Real IELTS leans on them heavily in Part 1.
- Numbers can be written in figures ("28") or words ("twenty-eight"); the
  validator soft-normalises both.
- Reading-ahead pauses are silent UI time — do NOT include text the
  narrator speaks during them. If the narrator says "You now have 30
  seconds to check your answers", that is a separate `narration` segment
  preceding the `reading-pause`.

## Output schema

Emit JSON that matches this shape exactly. Trailing commas are not
allowed. Comments are not allowed.

```json
{
  "track": "Academic" | "GeneralTraining",
  "difficulty": <integer 1..5>,
  "parts": [
    {
      "part": 1,
      "context": "social",
      "title": "<short part title, e.g. 'Booking a library card'>",
      "speakers": [
        {
          "id": "<stable id like 'narrator', 'receptionist', 'caller'>",
          "name": "<human label like 'Library receptionist'>",
          "role": "narrator" | "speaker",
          "accent": "british" | "american" | "australian" | "canadian" | "new-zealand"
        }
      ],
      "transcript": [
        { "kind": "narration", "text": "Now turn to Part 1." },
        {
          "kind": "questions-preview",
          "seconds": 30,
          "question_positions": [0, 1, 2, 3]
        },
        {
          "kind": "speech",
          "speaker_id": "receptionist",
          "text": "Good morning, how can I help?"
        },
        {
          "kind": "reading-pause",
          "seconds": 30,
          "instruction": "You now have 30 seconds to check your answers to Part 1."
        }
      ],
      "question_positions": [0, 1, 2, 3, 4],
      "completion_blocks": [
        {
          "id": "p1-form",
          "layout": "form",
          "title": "Library card application",
          "instructions": "Write NO MORE THAN TWO WORDS AND/OR A NUMBER for each answer.",
          "rows": [
            {
              "label": "Surname",
              "cells": [
                [ { "kind": "blank", "slot_id": "p1-surname" } ]
              ]
            },
            {
              "label": "Saturday arrival",
              "cells": [
                [
                  { "kind": "text", "text": "Saturdays at " },
                  { "kind": "blank", "slot_id": "p2-arrival-time" }
                ]
              ]
            }
          ]
        }
      ]
    }
    // ... parts 2, 3, 4 in the same shape
  ],
  "questions": [
    {
      "type": "listening-mcq-single",
      "position": 5,
      "prompt": "When was the community garden founded?",
      "points": 1,
      "correct_answer": {
        "options": [
          { "id": "A", "text": "2004" },
          { "id": "B", "text": "2014" },
          { "id": "C", "text": "2024" }
        ],
        "correct": "B"
      }
    },
    {
      "type": "listening-mcq-multi",
      "position": 6,
      "prompt": "Which TWO activities are described as well-attended?",
      "points": 2,
      "correct_answer": {
        "options": [
          { "id": "A", "text": "Beekeeping" },
          { "id": "B", "text": "Composting workshops" },
          { "id": "C", "text": "Seed-swap evenings" },
          { "id": "D", "text": "Yoga classes" },
          { "id": "E", "text": "Storytime" }
        ],
        "pick_count": 2,
        "correct": ["B", "C"]
      }
    },
    {
      "type": "listening-sentence-completion",
      "position": 4,
      "prompt": "Complete the sentence using NO MORE THAN ONE WORD AND/OR A NUMBER from the recording.",
      "points": 1,
      "correct_answer": {
        "stem": "The Premium membership costs ___ pounds a year.",
        "word_limit": 2,
        "accepted": ["28", "twenty-eight"]
      }
    },
    {
      "type": "listening-short-answer",
      "position": 17,
      "prompt": "What innovation regulated the release of energy in early mechanical clocks? (NO MORE THAN FOUR WORDS)",
      "points": 1,
      "correct_answer": {
        "word_limit": 4,
        "accepted": ["verge-and-foliot escapement", "escapement"]
      }
    },
    {
      "type": "listening-completion-blank",
      "position": 0,
      "prompt": "Surname",
      "points": 1,
      "correct_answer": {
        "block_id": "p1-form",
        "slot_id": "p1-surname",
        "word_limit": 2,
        "accepted": ["Costa"]
      }
    }
  ]
}
```

## Cross-field invariants the validator enforces

If you violate any of these, the whole generation is rejected and
re-rolled:

- For every `completion-blank` question, `block_id` must reference an
  existing block in some part's `completion_blocks`, and `slot_id` must
  reference an existing blank slot within that block.
- For every question, `position` must appear in exactly one part's
  `question_positions` array.
- For every `mcq-single`, the `correct` id must be one of the option ids.
- For every `mcq-multi`, every entry of `correct` must be an option id,
  `correct` must have at least 2 entries with no duplicates, and
  `pick_count` must equal `correct.length`.
- For every `sentence-completion` / `short-answer` / `completion-blank`,
  every accepted string must be findable in the parent part's transcript.

## What NOT to do

- Don't introduce question kinds outside the supported list.
- Don't use the `examiner` role — that's Speaking territory.
- Don't put numbers in `question_positions` that don't appear on any
  Question row — orphans are content bugs.
- Don't write `audio_clip` fields on transcript segments. TTS synthesis
  happens separately, at SuperAdmin-approval time, and overwrites
  whatever the model produces here.
- Don't generate culturally narrow content (uniquely Western references
  that disadvantage non-Western test-takers).

## Reminder

Return ONLY the JSON object. No prose, no markdown fences, no preamble.
