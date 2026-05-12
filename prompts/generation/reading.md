---
spec: reading-generation
version: 3
phase: 7
question_types_supported:
  - reading-mcq
  - reading-true-false-not-given
  - reading-yes-no-not-given
  - reading-sentence-completion
  - reading-short-answer
output_format: json
---

# IELTS Reading — passage and question generation

You are generating one IELTS Reading practice unit for the eLanguage Center
platform. The output is a **single JSON object** that conforms exactly to
the schema described below. No prose outside the JSON. No Markdown code
fences. No preamble. No trailing commentary.

The eLanguage Center platform serves both **Academic** and **General
Training** tracks. The caller will tell you which track. Honour the
register and length rules for the requested track. A misclassified passage
is treated as a hard validation failure.

## Hard rules

1. **The answer must be in the passage.** Every correct answer for every
   question must be verifiable from the passage alone. No outside
   knowledge. No inference beyond what the text literally supports —
   exception: Yes/No/Not Given questions may turn on the author's stated
   *opinions* in the passage.
2. **For `sentence-completion` and `short-answer`:** every string in the
   `accepted` array must appear verbatim, or as a soft-normalised match,
   somewhere in the passage. A grader will reject the whole generation
   if it can't find the string in the passage text. Choose answer keys
   that are literal passage substrings.
3. **Word limits are sacred.** When a question's `word_limit` is 3, no
   accepted answer may exceed 3 words. Count hyphenated tokens as one
   word.
4. **Use only the question types listed in the schema below.** Matching
   types and completion blocks are out of scope for this prompt and
   should NOT appear in your output.
5. **Never output an answer key inside the passage prose.** Don't write
   "(the answer is X)" or otherwise telegraph the answers.

## Track rules

### Academic

- Passage length: **700–900 words**. Stay inside this range. The validator
  rejects anything outside 600–950.
- Register: formal, expository, often academic topics — history, science,
  social science, design, technology, environment. No first-person except
  in explicit quoted material.
- Paragraphs: **5 to 7 paragraphs**, each labelled `A`, `B`, `C`, …
- Difficulty 5–7 targets band 6.0–7.5 readers. The requested `difficulty`
  number (1–5) maps roughly to ~5.0 / 6.0 / 6.5 / 7.0 / 8.0.

### General Training

- Passage length: **400–800 words**. The validator rejects anything outside
  400–800.
- Register: everyday or workplace English — guides, notices, instructions,
  letters, magazine-style articles. Less formal than Academic but never
  conversational filler.
- Paragraphs: **4 to 6 paragraphs**, each labelled `A`, `B`, `C`, …
- Difficulty 3–6 covers the typical GT range; treat the requested
  `difficulty` the same way as Academic.
- **Tag the passage with `gt_context`** matching the IELTS GT section it
  belongs to:
  - `"social-survival"` — everyday social texts (advertisements, notices,
    schedules, guides aimed at the general public, e.g. renting a flat,
    using public services).
  - `"workplace"` — work-related texts (memos, training materials, job
    descriptions, contracts).
  - `"general-reading"` — longer magazine-style or general-interest
    articles (usually slightly more formal; one is enough per mock).
  - Pick the closest match; if genuinely ambiguous, omit the field.

## Question mix

Generate **6 to 10 questions** in total. A passable mix is:

- 1–2 `reading-mcq`
- 2–3 `reading-true-false-not-given` (or `reading-yes-no-not-given` if the
  passage carries the author's opinions)
- 2–3 `reading-sentence-completion`
- 0–2 `reading-short-answer`

Use `position` 0-indexed in display order.

## Output schema

Emit JSON that matches this shape exactly. Trailing commas are not
allowed. Comments are not allowed.

```json
{
  "track": "Academic" | "GeneralTraining",
  "difficulty": <integer 1..5>,
  "passage": {
    "title": "<short title, max 80 chars>",
    "paragraphs": [
      { "label": "A", "text": "<paragraph A prose>" },
      { "label": "B", "text": "<paragraph B prose>" }
    ],
    "gt_context": "social-survival" | "workplace" | "general-reading"
    // (gt_context is OPTIONAL — required for GT outputs, omit on Academic)
  },
  "questions": [
    {
      "type": "reading-mcq",
      "position": 0,
      "prompt": "<the question stem>",
      "correct_answer": {
        "options": [
          { "id": "A", "text": "<option A text>" },
          { "id": "B", "text": "<option B text>" },
          { "id": "C", "text": "<option C text>" },
          { "id": "D", "text": "<option D text>" }
        ],
        "correct": "B"
      }
    },
    {
      "type": "reading-true-false-not-given",
      "position": 1,
      "prompt": "<statement>\n\nTrue / False / Not Given",
      "correct_answer": { "correct": "true" | "false" | "not given" }
    },
    {
      "type": "reading-yes-no-not-given",
      "position": 2,
      "prompt": "<opinion statement>\n\nYes / No / Not Given",
      "correct_answer": { "correct": "yes" | "no" | "not given" }
    },
    {
      "type": "reading-sentence-completion",
      "position": 3,
      "prompt": "Complete the sentence using NO MORE THAN TWO WORDS from the passage.",
      "correct_answer": {
        "stem": "<sentence with ___ marking the blank>",
        "word_limit": <integer 1..5>,
        "accepted": ["<exact passage substring>"]
      }
    },
    {
      "type": "reading-short-answer",
      "position": 4,
      "prompt": "<full question that the learner answers>",
      "correct_answer": {
        "word_limit": <integer 1..5>,
        "accepted": ["<exact passage substring>", "<optional alternative>"]
      }
    }
  ]
}
```

## Style guidance

- **Paragraph labels are storage-only for Phase 5 outputs.** Every
  paragraph still needs a `label` field in the JSON (`"A"`, `"B"`, …) —
  it's the canonical addressing on `body_json`. The learner will **not**
  see the labels rendered, because Phase 5 generates only MCQ / T/F/NG /
  Y/N/NG / sentence-completion / short-answer, and real IELTS hides
  paragraph letters when the test has no matching-headings or
  matching-information questions. Don't write paragraphs that lean on
  the visible letter (e.g. "as paragraph B noted earlier"). Write
  natural connected prose.
- Vary sentence length. Use one or two specific dates, figures, or names
  per passage — they make good completion targets.
- Distractors in MCQs should be plausible misreadings of the passage, not
  obviously wrong.
- Sentence-completion stems should paraphrase the passage, not quote it
  verbatim. The blank fills in the literal passage word(s).
- For Y/N/NG, the author's view must be discernible from the passage —
  hedged claims ("some researchers think…") do not count as the author's
  view.

## What NOT to do

- Don't add a `reading-matching-*` or `reading-completion-blank` question
  to the output. Phase 5 doesn't generate those.
- Don't quote the answer key in the passage prose ("The breakthrough
  came in 1843 — see Q4").
- Don't generate culturally narrow content (e.g. uniquely Western
  references that disadvantage non-Western test-takers). Bias toward
  topics with global salience: environment, science history, design,
  technology, public health.
- Don't include images, footnotes, or markdown formatting inside the
  passage text. Plain prose only.

## Reminder

Return ONLY the JSON object. No prose, no markdown fences, no preamble.
