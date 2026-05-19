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
eLanguage Center platform. A Listening section is the full shortened
four-part sitting we ship in product: four parts, played end-to-end,
**20–32 questions in total** (usually 5–8 per part). The output is a
**single JSON object** that conforms exactly to the schema described
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
   Generate them contiguously (0, 1, 2, …) in section order.
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
   hear**, in the real IELTS style: a single sentence of the form
   *"You will hear &lt;structural description of the audio&gt;."* The
   description names WHO is speaking and WHAT the scene is, briefly.
   Pick a fresh scenario every generation — do NOT default to the
   same handful of topics (see "Topic diversity" below).
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

## Topic diversity — critical

Pick **fresh, varied topics** every generation. The user may pass a
`Broad topic hint` in the user turn — if so, anchor on that hint. If
no hint is given, pick scenarios you have NOT used recently. Real
IELTS test pools rotate through dozens of scenarios; never default
to the same shortlist.

**Topics to AVOID** (overused in earlier generations — pick something
else unless the user hint explicitly asks for one):

- hotel / library / room booking
- community garden / park / volunteering
- university study group / dissertation tutorial
- mechanical clockmaking / history of clocks

**Healthy topic pools to draw from instead** (illustrative — invent
your own variations):

- Part 1 (social transactional): renting a flat, registering for a
  cycling club, ordering catering for an event, claiming insurance
  on a damaged parcel, signing up for a cooking class, returning a
  faulty appliance, applying for a swimming pool membership, joining
  a language exchange, requesting a refund from an airline, reserving
  a campsite, hiring camera equipment, scheduling a vet appointment.
- Part 2 (social monologue): audio guide at a maritime museum, radio
  segment on local recycling rules, voiceover for a city walking
  tour app, training induction for new volunteers at a food bank,
  in-flight safety briefing, podcast on regional festivals, opening
  of a community art exhibition, briefing for hikers on a national
  park trail.
- Part 3 (academic discussion): two students planning a field trip,
  group reviewing peer feedback on a presentation, tutor and student
  refining a research proposal in marketing / urban planning /
  ecology / linguistics / public health / industrial design, students
  debating methodology for a case study.
- Part 4 (academic lecture): history of cartography, neuroscience of
  sleep, economics of recycling, evolution of children's literature,
  architecture of opera houses, archaeology of trade routes,
  psychology of decision-making, geology of a mountain range,
  sociology of urban housing, materials science of textiles.

If the user passes a topic hint, ignore the avoid-list and follow
the hint — they are intentionally driving the topic.

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

Each part should contain 5–8 questions. Treat this as a hard target, not
just a style hint. Aim for variety across the five supported kinds. A
passable per-section distribution is:

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

> The values below ending in `…` are **placeholders that demonstrate
> shape only** — do NOT copy them into your output. Replace every
> placeholder with content that fits the topic you have chosen for
> this generation.

```json
{
  "track": "Academic" | "GeneralTraining",
  "difficulty": <integer 1..5>,
  "parts": [
    {
      "part": 1,
      "context": "social",
      "title": "<short part title — the scenario you chose>",
      "speakers": [
        {
          "id": "<stable id, e.g. 'narrator', 'speaker-a', 'caller'>",
          "name": "<human label, e.g. the role this speaker plays>",
          "role": "narrator" | "speaker",
          "accent": "british" | "american" | "australian" | "canadian" | "new-zealand"
        }
      ],
      "transcript": [
        { "kind": "narration", "text": "Part 1." },
        { "kind": "narration", "text": "You will hear <one-sentence scene description>." },
        { "kind": "narration", "text": "First you have some time to look at questions 1 to N." },
        {
          "kind": "questions-preview",
          "seconds": 30,
          "question_positions": [0, 1, 2, 3]
        },
        { "kind": "narration", "text": "Now listen carefully and answer questions 1 to N." },
        {
          "kind": "speech",
          "speaker_id": "<speaker id from above>",
          "text": "<natural opening line for your chosen scenario>"
        },
        { "kind": "narration", "text": "That is the end of Part 1. You now have half a minute to check your answers." },
        {
          "kind": "reading-pause",
          "seconds": 30
        }
      ],
      "question_positions": [0, 1, 2, 3, 4],
      "completion_blocks": [
        {
          "id": "p1-<short-id>",
          "layout": "form",
          "title": "<title that names this form/notes/table>",
          "instructions": "Write NO MORE THAN TWO WORDS AND/OR A NUMBER for each answer.",
          "rows": [
            {
              "label": "<field label>",
              "cells": [
                [ { "kind": "blank", "slot_id": "p1-<unique-slot-id>" } ]
              ]
            },
            {
              "label": "<another field label>",
              "cells": [
                [
                  { "kind": "text", "text": "<optional prefix text> " },
                  { "kind": "blank", "slot_id": "p1-<another-slot-id>" }
                ]
              ]
            }
          ]
        }
      ]
    }
  ],
  "questions": [
    {
      "type": "listening-mcq-single",
      "position": 5,
      "prompt": "<a question whose answer the speaker(s) actually say>",
      "points": 1,
      "correct_answer": {
        "options": [
          { "id": "A", "text": "<option A>" },
          { "id": "B", "text": "<option B>" },
          { "id": "C", "text": "<option C>" }
        ],
        "correct": "B"
      }
    },
    {
      "type": "listening-mcq-multi",
      "position": 6,
      "prompt": "Which TWO of the following are mentioned by the speaker?",
      "points": 2,
      "correct_answer": {
        "options": [
          { "id": "A", "text": "<option A>" },
          { "id": "B", "text": "<option B>" },
          { "id": "C", "text": "<option C>" },
          { "id": "D", "text": "<option D>" },
          { "id": "E", "text": "<option E>" }
        ],
        "pick_count": 2,
        "correct": ["B", "C"]
      }
    },
    {
      "type": "listening-sentence-completion",
      "position": 4,
      "prompt": "Complete the sentence using NO MORE THAN TWO WORDS AND/OR A NUMBER from the recording.",
      "points": 1,
      "correct_answer": {
        "stem": "<sentence with ___ marking the blank>",
        "word_limit": 2,
        "accepted": ["<verbatim word from the transcript>"]
      }
    },
    {
      "type": "listening-short-answer",
      "position": 17,
      "prompt": "<a question the speaker(s) answer aloud> (NO MORE THAN FOUR WORDS)",
      "points": 1,
      "correct_answer": {
        "word_limit": 4,
        "accepted": ["<verbatim phrase from the transcript>"]
      }
    },
    {
      "type": "listening-completion-blank",
      "position": 0,
      "prompt": "<field label matching the row in the completion block>",
      "points": 1,
      "correct_answer": {
        "block_id": "<block id from a part above>",
        "slot_id": "<slot id from that block>",
        "word_limit": 2,
        "accepted": ["<verbatim phrase from the transcript>"]
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
- Each part must keep the IELTS Part 1/2/3/4 context pattern, use 5–8
  question positions, and follow the narrator → preview → listen →
  speech → end-of-part → reading-pause scaffold.
- For every question, `position` must appear in exactly one part's
  `question_positions` array.
- The section must use only `narrator` / `speaker` roles and expose at
  least three distinct accents across the four parts.
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
