---
name: ai-grading
description: Use this skill when writing or modifying any AI grading prompt, scoring logic, or feedback generation for IELTS Writing or Speaking. Covers the canonical prompt structure, the four-criterion rubric application, defensibility checks against published sample answers, JSON response shape, and how to keep grading calibrated rather than generous. Trigger on any work in `prompts/grading/`, `packages/ai/src/grading/`, or anywhere band scores are computed or surfaced. Read alongside the `ielts-domain` skill — that one defines the rubrics, this one defines how Claude applies them.
---

# AI Grading Skill

## The contract

Every grading call returns this shape, validated by Zod before it ever reaches the learner:

```ts
{
  band_overall: 5.5,         // 0–9, halves only
  criteria: {
    task_achievement:    { band: 6.0, justification: "...", evidence: "quote from response" },
    coherence_cohesion:  { band: 5.5, justification: "...", evidence: "..." },
    lexical_resource:    { band: 5.0, justification: "...", evidence: "..." },
    grammatical_range:   { band: 5.5, justification: "...", evidence: "..." }
  },
  strengths:    ["...", "..."],   // 2–4 specific positives
  improvements: ["...", "..."],   // 2–4 actionable next steps
  next_drill:   "task-2-coherence-paragraphing"  // tag matching a practice module
}
```

If the model returns invalid JSON, retry once with a stricter `response_format`. If it fails twice, escalate to a fallback and surface "AI grading is having a moment, retry in a few minutes" rather than fabricating a score.

## Prompt structure (Writing)

Every grading prompt has this skeleton:

```md
# Role
You are an experienced IELTS examiner trained on the official band descriptors
published by IDP and the British Council. You score Writing Task {N} on the four
criteria: Task {Achievement|Response}, Coherence and Cohesion, Lexical Resource,
Grammatical Range and Accuracy.

# Calibration
Be calibrated, not generous. A 6.0 from you must align with a 6.0 from a real
examiner. When in doubt between two bands, pick the lower and explain what would
move it to the higher one. Never produce non-half bands like 6.3.

# Task
The candidate was given this prompt:
<<TASK_PROMPT>>

Their response:
<<RESPONSE>>

# Output
Return only JSON matching the schema below. No preamble, no postamble.
<<JSON_SCHEMA>>

# Evidence requirement
Every criterion `justification` must quote a specific phrase from the response.
If the response is too short or off-topic to evaluate fairly, set band_overall
to the appropriate low band and explain in `improvements` what's missing.
```

The same pattern for Speaking, with the four Speaking criteria and the transcript + audio-feature inputs.

## Calibration anchors

`prompts/grading/anchors/` contains 12 hand-graded sample responses (3 per band: 5.0, 6.0, 7.0, 8.0). Every grading prompt includes 2 anchors near the expected band as few-shot examples. The anchors come from published IELTS sample materials with our own examiner-validated band assignments.

**When updating a grading prompt**, regenerate scores against the anchor set and check drift. If our 6.0 anchor now scores 6.5, the prompt got more generous — pull it back.

## Why we quote evidence

Two reasons:
1. Learners trust scores more when they see exactly which phrase triggered the mark.
2. It keeps Claude honest. Without an evidence requirement, the model will hand-wave with generic feedback like "good vocabulary range" — which is useless.

## Speaking grading specifics

Speaking grading takes both transcript (Whisper output) and audio features (extracted via `packages/ai/src/audio/features.ts` — pitch range, speaking rate, pause distribution). Pronunciation scoring is impossible from transcript alone:

```ts
const features = await extractAudioFeatures(recording.url);
// { wpm, pause_count, mean_pause_ms, pitch_range_hz, articulation_rate, ... }

const grade = await ai.chat({
  ctx,
  purpose: "speaking-grade",
  model: "claude-sonnet-4-7",
  messages: [
    { role: "system", content: speakingGradingPrompt },
    { role: "user", content: JSON.stringify({ transcript, features, partsCovered }) },
  ],
});
```

We **do not** attempt L1-accent classification. We score intelligibility and the four official criteria — accent variation that doesn't impede communication does not lower the band.

## Defensibility

Every quarter, randomly sample 50 graded attempts and have a real IELTS examiner re-grade them blind. Track:
- Mean absolute error in overall band.
- Per-criterion error.
- Direction of bias (are we generous? strict? on which criteria?).

Target: MAE ≤ 0.5 bands overall. If we drift, prompt updates ship that quarter.

## Anti-patterns

- ❌ Returning a "rounded average" without showing the criterion bands.
- ❌ Praise without specifics. "Great essay!" is not feedback.
- ❌ Marking down for accent. The rubric scores intelligibility and pronunciation features, not nativeness.
- ❌ Using GPT-4o-mini for grading because it's cheaper. Grading is the place we pay for quality.
- ❌ Generating a "next_drill" tag that doesn't exist in our practice catalog. Validate the tag against the catalog before returning.
- ❌ Fabricating a score because the response is too short. Score the actual response and note the brevity in `improvements`.

## Versioning prompts

Every grading prompt is a Markdown file in `prompts/grading/` with a frontmatter version. Bumping the version forces re-runs of the anchor calibration set in CI. Old prompt versions stay around for replay/debugging — never delete.

```md
---
version: 2.3.0
section: writing
task: 2
last_calibrated: 2026-04-22
mae_overall: 0.42
---
```
