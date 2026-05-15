// Semantic validator for generated Speaking content.
//
// The Zod schema (speaking-schema.ts) catches structural mistakes — wrong
// counts, missing fields, lengths. This module catches the content mistakes
// the schema cannot: a cue card that isn't phrased as "Describe …", a final
// prompt that doesn't read as the canonical "and explain …" closer, Part 3
// "discussion questions" that aren't actually questions, or the model
// repeating itself.
//
// A failure here rejects the whole generation; the caller re-rolls. Issue
// codes are stable so the SuperAdmin UI can group by code.

import type { GeneratedSpeaking } from "./speaking-schema";

export type SpeakingValidationIssue = {
  code:
    | "cue-card.not-describe-prompt"
    | "cue-card.malformed-final-prompt"
    | "part1.not-question-shaped"
    | "part3.not-question-shaped"
    | "content.duplicate-question";
  message: string;
};

export type SpeakingValidationResult =
  | { ok: true }
  | { ok: false; issues: SpeakingValidationIssue[] };

// IELTS Part 1 / Part 3 prompts are either interrogatives ("What …?") or the
// examiner's canonical imperatives ("Tell me about …", "Describe …"). We
// accept a trailing "?" OR one of those openers so a perfectly normal
// "Tell me about your hometown." isn't wrongly rejected.
const IMPERATIVE_OPENER = /^(tell me|describe|talk about|let'?s talk about)\b/i;

function looksLikePrompt(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.endsWith("?") || IMPERATIVE_OPENER.test(trimmed);
}

export function validateGeneratedSpeaking(
  value: GeneratedSpeaking,
): SpeakingValidationResult {
  const issues: SpeakingValidationIssue[] = [];

  // ── Part 2 cue card ────────────────────────────────────────────────────
  if (!/^describe\b/i.test(value.part2.cue_card_topic.trim())) {
    issues.push({
      code: "cue-card.not-describe-prompt",
      message: `Cue card topic "${value.part2.cue_card_topic}" does not start with "Describe" — the canonical IELTS Part 2 format.`,
    });
  }
  if (!/^and\s+\S/i.test(value.part2.final_prompt.trim())) {
    issues.push({
      code: "cue-card.malformed-final-prompt",
      message: `Cue card final prompt "${value.part2.final_prompt}" should begin with "and " (e.g. "and explain why …").`,
    });
  }

  // ── Part 1 question shape ──────────────────────────────────────────────
  for (const sub of value.part1.subtopics) {
    for (const q of sub.questions) {
      if (!looksLikePrompt(q)) {
        issues.push({
          code: "part1.not-question-shaped",
          message: `Part 1 prompt "${q}" (subtopic "${sub.topic}") is neither a question nor a "Tell me about …" prompt.`,
        });
      }
    }
  }

  // ── Part 3 question shape ──────────────────────────────────────────────
  for (const q of value.part3.questions) {
    if (!looksLikePrompt(q)) {
      issues.push({
        code: "part3.not-question-shaped",
        message: `Part 3 discussion prompt "${q}" is neither a question nor a "Tell me about …" prompt.`,
      });
    }
  }

  // ── Duplicate detection across every prompt in the test ────────────────
  const seen = new Set<string>();
  const allPrompts = [
    ...value.part1.subtopics.flatMap((s) => s.questions),
    ...value.part2.bullets,
    ...value.part2.followup_questions,
    ...value.part3.questions,
  ];
  for (const p of allPrompts) {
    const key = p.trim().toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) {
      issues.push({
        code: "content.duplicate-question",
        message: `The prompt "${p}" appears more than once in the test.`,
      });
    }
    seen.add(key);
  }

  if (issues.length === 0) return { ok: true };
  return { ok: false, issues };
}
