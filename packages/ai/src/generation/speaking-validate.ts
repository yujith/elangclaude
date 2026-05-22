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
    | "topic-domain.word-count"
    | "cue-card.not-describe-prompt"
    | "cue-card.malformed-final-prompt"
    | "part1.missing-home-work-study-opening"
    | "part1.not-question-shaped"
    | "part2.followup.not-question-shaped"
    | "part3.not-question-shaped"
    | "part3.not-linked-to-part2"
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
const PART1_OPENING_HINT =
  /\b(hometown|home|house|flat|apartment|accommodation|neighbou?rhood|area|live|work|job|career|study|school|college|university|subject)\b/i;
const TOPIC_STOPWORDS = new Set([
  "about",
  "again",
  "also",
  "because",
  "candidate",
  "changed",
  "describe",
  "discussion",
  "during",
  "explain",
  "future",
  "important",
  "people",
  "recent",
  "recently",
  "should",
  "society",
  "something",
  "their",
  "there",
  "these",
  "those",
  "think",
  "topic",
  "would",
]);

function looksLikePrompt(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.endsWith("?") || IMPERATIVE_OPENER.test(trimmed);
}

function looksLikeQuestion(text: string): boolean {
  return text.trim().endsWith("?");
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normaliseTopicToken(token: string): string {
  let text = token.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  if (text.endsWith("ies") && text.length > 4) text = `${text.slice(0, -3)}y`;
  else if (text.endsWith("ing") && text.length > 5) text = text.slice(0, -3);
  else if (text.endsWith("ed") && text.length > 4) text = text.slice(0, -2);
  else if (text.endsWith("es") && text.length > 4) text = text.slice(0, -2);
  else if (text.endsWith("s") && text.length > 4) text = text.slice(0, -1);
  return text;
}

function topicalTokens(text: string): Set<string> {
  return new Set(
    text
      .split(/[^A-Za-z0-9]+/)
      .map(normaliseTopicToken)
      .filter(
        (token) =>
          token.length >= 4 && !TOPIC_STOPWORDS.has(token),
      ),
  );
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) count += 1;
  }
  return count;
}

export function validateGeneratedSpeaking(
  value: GeneratedSpeaking,
): SpeakingValidationResult {
  const issues: SpeakingValidationIssue[] = [];

  const topicDomainWords = wordCount(value.topic_domain);
  if (topicDomainWords < 2 || topicDomainWords > 5) {
    issues.push({
      code: "topic-domain.word-count",
      message: `topic_domain "${value.topic_domain}" must be 2-5 words; found ${topicDomainWords}.`,
    });
  }

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

  // ── Part 1 opening topic ───────────────────────────────────────────────
  const opening = value.part1.subtopics[0];
  if (opening) {
    const openingText = [opening.topic, ...opening.questions].join(" ");
    if (!PART1_OPENING_HINT.test(openingText)) {
      issues.push({
        code: "part1.missing-home-work-study-opening",
        message: `Part 1 should open with home, hometown, work, or study. First subtopic "${opening.topic}" does not look like that opener.`,
      });
    }
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

  // ── Part 2 follow-up question shape ────────────────────────────────────
  for (const q of value.part2.followup_questions) {
    if (!looksLikeQuestion(q)) {
      issues.push({
        code: "part2.followup.not-question-shaped",
        message: `Part 2 follow-up "${q}" should be a short question ending with "?".`,
      });
    }
  }

  // ── Part 3 question shape ──────────────────────────────────────────────
  for (const q of value.part3.questions) {
    if (!looksLikeQuestion(q)) {
      issues.push({
        code: "part3.not-question-shaped",
        message: `Part 3 discussion prompt "${q}" should be an abstract question ending with "?".`,
      });
    }
  }

  // ── Part 2 ⇄ Part 3 thematic continuity ───────────────────────────────
  const domainTokens = topicalTokens(value.topic_domain);
  const part2Tokens = topicalTokens(
    [
      value.part2.cue_card_topic,
      ...value.part2.bullets,
      value.part2.final_prompt,
    ].join(" "),
  );
  const part3Tokens = topicalTokens(
    [value.part3.theme, ...value.part3.questions].join(" "),
  );
  const directOverlap = overlapCount(part2Tokens, part3Tokens);
  const domainBridgesPart2 = overlapCount(domainTokens, part2Tokens);
  const domainBridgesPart3 = overlapCount(domainTokens, part3Tokens);
  if (
    directOverlap < 2 &&
    !(domainBridgesPart2 >= 1 && domainBridgesPart3 >= 1)
  ) {
    issues.push({
      code: "part3.not-linked-to-part2",
      message:
        "Part 3 does not appear to expand the same topic domain as Part 2. Keep topic_domain, the cue card, and the discussion questions on the same IELTS theme.",
    });
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
