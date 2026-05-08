---
name: ielts-domain
description: Use this skill whenever generating IELTS test content, writing grading prompts, validating questions, or evaluating learner responses. Covers question types per section, the four band-scoring criteria for Writing and Speaking, Academic vs General Training differences, timing rules, and common rubric misuses. Trigger on any work touching `prompts/generation/`, `prompts/grading/`, `packages/ai/src/grading/`, or test/question schemas. If you find yourself writing IELTS-related content without consulting this, stop and read it.
---

# IELTS Domain Skill

## Why this skill exists

IELTS has rigid, well-documented standards. Getting question types wrong, mis-numbering bands, or applying the wrong rubric to the wrong section makes our product fail its only job. This skill is the single source for what IELTS actually is, in the form Claude needs while writing prompts.

## The four sections at a glance

| Section | Time | Skills |
|---|---|---|
| Listening | ~30 min + 10 min transfer | 4 parts, 40 questions, recordings played once |
| Reading (Academic) | 60 min | 3 long passages, 40 questions |
| Reading (General) | 60 min | Mix of short workplace/social texts, then one longer, 40 questions |
| Writing (Academic) | 60 min | Task 1: describe a chart/graph/process (150 words). Task 2: essay (250 words). |
| Writing (General) | 60 min | Task 1: letter — formal/semi-formal/informal (150 words). Task 2: essay (250 words). |
| Speaking | 11–14 min | Part 1: intro Qs. Part 2: 1–2 min long turn from cue card (1 min prep). Part 3: discussion. |

**Band scale: 0–9, in 0.5 increments.** Overall band is the average of the four section bands, rounded to the nearest half band.

## Question types Claude must generate correctly

### Reading & Listening shared

- Multiple choice (MCQ)
- True / False / Not Given (Reading) and Yes / No / Not Given (opinion-based passages)
- Matching headings (paragraphs to headings)
- Matching information (find which paragraph contains X)
- Matching features (e.g., match findings to researchers)
- Matching sentence endings
- Sentence completion (fill the blank, word limit specified)
- Summary completion (with or without word bank)
- Note / Table / Flow-chart / Diagram-label completion
- Short-answer questions (word limit specified)

### Listening only

- Form / Note / Table / Flow-chart / Summary completion
- Plan / Map / Diagram labelling

### Writing tasks

- Task 1 Academic: report on a graph, chart, table, map, process, or diagram. Objective tone.
- Task 1 General: letter (formal: complaint/inquiry; semi-formal: to a teacher/employer; informal: to a friend).
- Task 2 (both tracks): discursive essay — opinion, discussion, problem/solution, advantages/disadvantages, two-part question.

### Speaking parts

- Part 1: 4–5 min, familiar topics (work, study, hometown, hobbies).
- Part 2: cue card with 3–4 bullet prompts; learner speaks 1–2 min.
- Part 3: 4–5 min discussion expanding on Part 2 topic abstractly.

## Grading criteria — the rubrics

### Writing (4 criteria, each 0–9, average → band)

1. **Task Achievement** (Task 1) / **Task Response** (Task 2) — addressed all parts, clear position, sufficient development.
2. **Coherence and Cohesion** — paragraphing, logical flow, range of cohesive devices (without overuse).
3. **Lexical Resource** — range, accuracy, and appropriacy of vocabulary; collocations.
4. **Grammatical Range and Accuracy** — variety of structures, error frequency, communication impact.

### Speaking (4 criteria, each 0–9, average → band)

1. **Fluency and Coherence** — pace, hesitation, self-correction, logical sequencing.
2. **Lexical Resource** — range, paraphrase ability, idiomatic use at higher bands.
3. **Grammatical Range and Accuracy** — variety, error frequency, complex structures.
4. **Pronunciation** — individual sounds, word stress, sentence stress, intonation, intelligibility.

## Rules for Claude when generating content

- **Always tag generated content** with `track` (academic/general), `section`, `difficulty` (1–5 mapped to band targets ~5.0/6.0/6.5/7.0/8.0), `topic`, and `question_type`.
- **Word limits are sacred.** "No more than 3 words" means 3 words. Generate answer keys that respect this.
- **Listening transcripts** must include speaker labels and natural-sounding fillers ("um", "well") — they reflect real speech.
- **Reading passages**: Academic = 700–900 words, formal register, often academic topics. General = workplace/everyday register.
- **Cue cards** (Speaking Part 2) follow the format: "Describe X. You should say: — what... — when... — where... — and explain why..."

## Rules for Claude when grading

- **Output the full criterion breakdown**, not just the overall band. Learners need to know which dimension to improve.
- **Cite the response** — quote the specific phrase being evaluated. ("In paragraph 2 you wrote 'The graph show...' — subject-verb agreement.")
- **Be calibrated, not generous.** A 6.0 essay in our product must align with a 6.0 from a real examiner. When in doubt, mark down with a clear path to up.
- **Never invent facts** about IELTS bands — if Claude isn't sure, it must say "I'm scoring this 6.5 based on these specific criteria" rather than inventing a fifth criterion.

## Anti-patterns

- ❌ Asking Reading questions whose answers aren't literally in the passage (IELTS Reading is not inference-heavy in the way TOEFL is — exception: Yes/No/Not Given on opinion pieces).
- ❌ Generating Speaking cue cards on highly culture-specific topics that disadvantage non-Western test-takers.
- ❌ Grading Writing Task 2 with a Task 1 rubric or vice versa.
- ❌ Returning a band like "7.3" — only halves: 7.0, 7.5, 8.0.

## Where the prompts live

`prompts/generation/{reading,listening,writing,speaking}.md` and `prompts/grading/{writing,speaking}.md`. Edit them in PRs with diffs reviewed by humans — these are the contract with our learners.
