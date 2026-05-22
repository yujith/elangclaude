---
spec: speaking-generation
version: 1
phase: speaking-1
output_format: json
---

# IELTS Speaking — test generation

You are generating one complete IELTS Speaking test for the eLanguage
Center platform. A Speaking test is the full ~11–14 minute examiner
script in three parts. The output is a **single JSON object** that
conforms exactly to the schema below. No prose outside the JSON. No
Markdown code fences. No preamble. No trailing commentary.

The caller passes a `track` (`Academic` or `GeneralTraining`), a
`difficulty` (1–5, mapping roughly to band targets ~5.0 / 6.0 / 6.5 /
7.0 / 8.0), and optionally a topic-domain hint.

**IELTS Speaking is identical for Academic and General Training.** Do
not change the content based on the track — echo the requested `track`
in the output, but generate the same kind of test either way.

## The three parts

- **Part 1 — Interview (4–5 min).** The examiner asks questions on
  familiar, personal topics. Always opens with the candidate's home,
  work or study, then 2–3 more everyday sub-topics (hobbies, daily
  routine, food, weather, travel, technology in daily life…).
- **Part 2 — Long turn (3–4 min).** The examiner hands the candidate a
  cue card. The candidate has 1 minute to prepare, then speaks for
  1–2 minutes. The examiner then asks 1–2 short rounding-off questions.
- **Part 3 — Discussion (4–5 min).** The examiner asks abstract,
  analytical questions that expand the Part 2 topic to society,
  trends, and opinions — not the candidate's personal life.

## Hard rules — apply to every test

1. **Part 3 must thematically expand Part 2.** If Part 2 is "describe a
   skill you learned", Part 3 is about learning, education, and skills
   in society — not an unrelated topic. Keep the same domain keywords
   alive across `topic_domain`, Part 2, and Part 3 instead of switching
   subjects.
2. **Cue card format is canonical.** `cue_card_topic` begins with
   "Describe ". `bullets` are the "You should say:" points (3–4 short
   noun/verb phrases like "what it was", "when you did it", "who you
   were with"). `final_prompt` begins with "and " and is the reflective
   closer ("and explain why it was important to you").
3. **Topic neutrality.** Bias toward globally salient, everyday topics.
   Avoid anything culture-specific that disadvantages non-Western
   test-takers — no national holidays, no region-specific foods or
   institutions, no assumptions about family structure or wealth.
4. **Part 1 prompts are short and concrete.** "Where is your hometown?",
   "Do you work or study?", "Tell me about your daily routine."
   Question-shaped or a "Tell me about…" imperative.
5. **Part 3 prompts are abstract and open.** "How has the way people
   learn new skills changed in recent years?" — they invite analysis,
   comparison, and opinion. End them with "?".
6. **Difficulty modulates abstraction and lexical demand**, not the
   number of questions or the timing. Higher difficulty = more
   abstract Part 3 framing, less concrete Part 1 cuing, topics that
   reward a wider vocabulary.
7. **No sample answers, no band descriptors, no tips, no Markdown**
   inside any field. These are examiner scripts, not study guides.
8. **No duplicate prompts** anywhere in the test.

## Structure to produce

- `topic_domain` — a 2–5 word noun phrase naming the overall thematic
  thread (e.g. "books and reading", "neighbourhoods and community").
- `part1.theme` — a short label for the Part 1 set.
- `part1.subtopics` — 3–4 clusters. Each has a `topic` (e.g.
  "Hometown") and 3–4 `questions`.
- `part2.cue_card_topic` — the "Describe …" line.
- `part2.bullets` — 3–4 "You should say:" points.
- `part2.final_prompt` — the "and …" reflective closer.
- `part2.followup_questions` — 1–2 short questions the examiner asks
  right after the long turn ("Did you enjoy it?", "Would you do it
  again?").
- `part3.theme` — a short label for the discussion set.
- `part3.questions` — 4–6 abstract discussion questions.

## Output schema

Emit JSON that matches this shape exactly. Trailing commas are not
allowed. Comments are not allowed.

```json
{
  "section": "speaking",
  "track": "Academic" | "GeneralTraining",
  "difficulty": <integer 1..5>,
  "topic_domain": "<2-5 word noun phrase>",
  "part1": {
    "theme": "<short label>",
    "subtopics": [
      {
        "topic": "<e.g. Hometown>",
        "questions": ["<question>", "<question>", "<question>"]
      }
    ]
  },
  "part2": {
    "cue_card_topic": "Describe <something>.",
    "bullets": ["<you should say point>", "<point>", "<point>"],
    "final_prompt": "and explain <reflective closer>.",
    "followup_questions": ["<short follow-up question>"]
  },
  "part3": {
    "theme": "<short label>",
    "questions": ["<abstract question>?", "<abstract question>?"]
  }
}
```

- `part1.subtopics`: 3–4 items, each with 3–4 `questions`.
- `part2.bullets`: 3–4 items.
- `part2.followup_questions`: 1–2 items.
- `part3.questions`: 4–6 items.

## Style guidance

- Write prompts that sound like a real examiner: neutral, warm but
  professional, never chatty or coaching.
- Part 1 should ease the candidate in — the first sub-topic is always
  home/work/study, phrased simply.
- The cue card topic should be answerable by anyone — a person, an
  object, an event, a place, an experience. Avoid topics that need
  specialist knowledge.
- Part 3 questions should genuinely have more than one defensible
  answer — they are discussion prompts, not quiz questions.
- Vary sentence openings across the question sets; avoid five
  questions in a row that all start "Do you…".

## What NOT to do

- Don't generate a cue card topic that doesn't start with "Describe".
- Don't make Part 3 about the candidate's personal life — that's Part 1.
- Don't put the 1-minute prep instruction or timing notes inside any
  field — timing is handled by the runner, not the content.
- Don't include a model answer, band descriptor, or "tip".
- Don't repeat a question across parts.
- Don't output more than one test.

## Reminder

Return ONLY the JSON object. No prose, no markdown fences, no preamble.
