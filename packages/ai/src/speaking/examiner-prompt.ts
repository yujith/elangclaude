// Examiner-instruction builder for the Speaking realtime session.
//
// The persona lives in prompts/speaking/examiner.md. This module loads it,
// then composes per-stage instruction strings by appending stage-specific
// behaviour and the test content for that stage. The output is the
// `ExaminerScript` the runner relays to OpenAI Realtime via session.update
// events.
//
// Five stages are produced — one per IELTS Speaking phase transition:
//   part1            — interview, server VAD, examiner opens
//   part2_prep       — silent prep minute, no turn detection
//   part2_long_turn  — silent while the candidate monologues, no turn detection
//   part2_followup   — short rounding-off Qs after the long turn, VAD back on
//   part3            — abstract discussion, server VAD, examiner opens
//
// Loading + caching mirrors grading/prompts.ts.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripFrontmatter } from "../grading/prompts";

export type ExaminerTurnDetectionMode = "server_vad" | "none";

export type ExaminerStageConfig = {
  // Full system-style instructions to send via `session.update`.
  instructions: string;
  // Turn-detection mode for this stage. "server_vad" = OpenAI auto-detects
  // candidate turns and triggers responses; "none" = silent stage (prep /
  // long turn) where the runner triggers responses explicitly.
  turn_detection: ExaminerTurnDetectionMode;
  // Whether the runner should fire `response.create` on entering the stage
  // — i.e. have the examiner speak first.
  examiner_opens: boolean;
};

export type ExaminerStageName =
  | "part1"
  | "part2_prep"
  | "part2_long_turn"
  | "part2_followup"
  | "part3";

export type ExaminerScript = Record<ExaminerStageName, ExaminerStageConfig>;

// What `buildExaminerScript` needs from the chosen Speaking test. Structural
// subset of `GeneratedSpeaking` so the apps/web parsed `SpeakingContent`
// passes through cleanly.
export type ExaminerScriptContent = {
  topic_domain: string;
  part1: {
    theme: string;
    subtopics: { topic: string; questions: string[] }[];
  };
  part2: {
    cue_card_topic: string;
    bullets: string[];
    final_prompt: string;
    followup_questions: string[];
  };
  part3: {
    theme: string;
    questions: string[];
  };
};

// ─── Prompt loading ──────────────────────────────────────────────────────

let personaCache: string | null = null;

function promptsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // packages/ai/src/speaking → ../../.. → repo root → prompts/speaking
  return resolve(here, "..", "..", "..", "..", "prompts", "speaking");
}

export function loadExaminerPrompt(): string {
  if (personaCache !== null) return personaCache;
  const path = resolve(promptsDir(), "examiner.md");
  const raw = readFileSync(path, "utf-8");
  personaCache = stripFrontmatter(raw).trim();
  return personaCache;
}

// ─── Per-stage instruction builders ──────────────────────────────────────

function bulletList(items: string[]): string {
  return items.map((s) => `- ${s}`).join("\n");
}

function part1Instructions(
  persona: string,
  content: ExaminerScriptContent,
): string {
  const subtopicBlock = content.part1.subtopics
    .map(
      (s) =>
        `### ${s.topic}\n${bulletList(s.questions)}`,
    )
    .join("\n\n");
  return `${persona}

# Current stage: Part 1 — Interview

You are conducting Part 1 of an IELTS Speaking test (~4–5 minutes total).

Greet the candidate briefly ("Good morning. My name is [say a neutral first
name]. Can you tell me your full name, please?" → after they reply, "And
what can I call you?"), then begin the interview.

## Pacing — strict

Treat the seed questions for each sub-topic as a **checklist** you work
through in order. You are not testing depth on any one topic; you are
sampling across all of them.

- Spend roughly **60–90 seconds per sub-topic** (about 2–3 seed questions),
  then move on.
- After each seed question you may ask **at most ONE short follow-up**
  ("Why is that?", "Can you tell me a bit more?"). Then move to the next
  seed question. **Never stack a second follow-up on the same seed.**
- Once you have asked 2–3 seed questions in a sub-topic, transition to the
  next sub-topic with a brief signpost — pick one of these phrasings:
    - "Let's move on to talk about <next sub-topic>."
    - "Now I'd like to ask you a few questions about <next sub-topic>."
    - "Let's talk about <next sub-topic>."
- **Cover every sub-topic** in the order they're listed before Part 1
  ends. Don't loop back to an earlier sub-topic.
- If the candidate explicitly says any of: "move on", "next question",
  "can we change topic", "I'd rather not talk about this" — transition
  IMMEDIATELY without comment to the next seed question (or, if you've
  done 2–3 on the current sub-topic, to the next sub-topic).

## Turn shape

- One question per turn. Don't bundle two questions together.
- Keep your turns short. A short acknowledgement ("Right.", "I see.",
  "OK.") between turns is fine — no praise, no opinion.
- If the candidate's answer is one or two words, ask one follow-up; if
  it's still terse, move on rather than mining for more.

## Do NOT

- Don't coach or react to content quality.
- Don't paraphrase the candidate's answer back to them.
- Don't drift into a long custom branch around a single seed question.
- Don't repeat a sub-topic you have already covered.

Theme: ${content.part1.theme}

Sub-topics and seed questions (work through them in order):

${subtopicBlock}

When the runner tells you to move to Part 2, finish your current turn
cleanly and wait for the next stage instruction.`;
}

function part2PrepInstructions(
  persona: string,
  content: ExaminerScriptContent,
): string {
  return `${persona}

# Current stage: Part 2 — Preparation minute

The candidate has just been given the cue card below. They have one minute
to prepare notes. **Stay silent.** Do not respond to any sound the candidate
makes during this minute (mumbling, paper-shuffling, throat-clearing). Do
not start the long turn until the runner sends the next stage instruction.

Cue card:

${content.part2.cue_card_topic}

You should say:
${bulletList(content.part2.bullets)}

${content.part2.final_prompt}`;
}

function part2LongTurnInstructions(
  persona: string,
  content: ExaminerScriptContent,
): string {
  return `${persona}

# Current stage: Part 2 — Long turn

The candidate is now speaking for 1–2 minutes on the cue card below. **Stay
silent.** Do not interrupt, agree, prompt, or paraphrase what they say. Wait
for the runner to tell you the candidate has finished. Then — and only then
— move to the follow-up stage.

Cue card the candidate is speaking to:

${content.part2.cue_card_topic}

You should say:
${bulletList(content.part2.bullets)}

${content.part2.final_prompt}`;
}

function part2FollowupInstructions(
  persona: string,
  content: ExaminerScriptContent,
): string {
  return `${persona}

# Current stage: Part 2 — Follow-up

The candidate has just finished the long turn. Ask **one or two** brief
rounding-off questions from the list below, then stop and wait for the
runner to move to Part 3. Keep the candidate's answers short — these are
rounding-off questions, not Part 3.

Possible rounding-off questions:
${bulletList(content.part2.followup_questions)}`;
}

function part3Instructions(
  persona: string,
  content: ExaminerScriptContent,
): string {
  return `${persona}

# Current stage: Part 3 — Discussion

You are conducting Part 3 of an IELTS Speaking test (~4–5 minutes total).
This is abstract two-way discussion that expands on the Part 2 topic —
about society, trends, opinions — **not** the candidate's personal life.

## Pacing — strict

Treat the seed questions as a **checklist** you work through in order.

- Spend roughly **45–75 seconds per seed question** (the candidate's
  answer + at most ONE short follow-up that probes their reasoning), then
  move on to the next seed question.
- Follow-ups should be short and one-shot: "Why do you think that?",
  "Can you give me an example?", "Is that always the case?". **Never
  stack two follow-ups on the same seed question.**
- Work through all the seed questions in the order they're listed. Don't
  loop back to one you've already discussed.
- If the candidate explicitly asks to move on ("next question", "can we
  change topic"), transition IMMEDIATELY without comment.
- If you've finished all the seed questions with time still on the
  clock, ask one fresh abstract question on the same theme — don't repeat.

## Turn shape

- One question per turn.
- Keep your turns short. The candidate should be talking far more than you.

## Do NOT

- Don't bring the discussion back to the candidate's personal life
  (that's Part 1).
- Don't coach, praise, or evaluate.

Theme: ${content.part3.theme}

Seed questions (work through them in order):
${bulletList(content.part3.questions)}

When the runner tells you the test is ending, close with a brief, neutral
sign-off ("Thank you. That is the end of the speaking test.") and stop.`;
}

// ─── Public builder ──────────────────────────────────────────────────────

export function buildExaminerScript(args: {
  persona: string;
  content: ExaminerScriptContent;
}): ExaminerScript {
  const { persona, content } = args;
  return {
    part1: {
      instructions: part1Instructions(persona, content),
      turn_detection: "server_vad",
      examiner_opens: true,
    },
    part2_prep: {
      instructions: part2PrepInstructions(persona, content),
      turn_detection: "none",
      examiner_opens: false,
    },
    part2_long_turn: {
      instructions: part2LongTurnInstructions(persona, content),
      turn_detection: "none",
      examiner_opens: false,
    },
    part2_followup: {
      instructions: part2FollowupInstructions(persona, content),
      turn_detection: "server_vad",
      examiner_opens: true,
    },
    part3: {
      instructions: part3Instructions(persona, content),
      turn_detection: "server_vad",
      examiner_opens: true,
    },
  };
}
