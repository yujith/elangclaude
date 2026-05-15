// Read-side parser + render helpers for the Speaking content stored on
// `Test.body_json`. Mirrors lib/writing/visual.ts: the DB stores arbitrary
// JSON; this module owns the parser and the rendering contract. A malformed
// row returns null and the surface refuses to render it rather than crash.
// No Zod dependency in apps/web (per ADR 0003 D1).
//
// The write-side shape is the Zod-validated `GeneratedSpeaking` in @elc/ai;
// `persistGeneratedSpeaking` stores `{ topic_domain, part1, part2, part3 }`
// on body_json. If you change one shape, change the other — see
// docs/adr/0006-speaking-data-shape.md.

export type SpeakingPart1Subtopic = { topic: string; questions: string[] };
export type SpeakingPart1 = {
  theme: string;
  subtopics: SpeakingPart1Subtopic[];
};
export type SpeakingPart2 = {
  cue_card_topic: string;
  bullets: string[];
  final_prompt: string;
  followup_questions: string[];
};
export type SpeakingPart3 = { theme: string; questions: string[] };

export type SpeakingContent = {
  topic_domain: string;
  part1: SpeakingPart1;
  part2: SpeakingPart2;
  part3: SpeakingPart3;
};

// The `Question.type` strings persistGeneratedSpeaking writes, in part order.
// The Phase 2 runner + Phase 3 transcript pipeline key on these.
export const SPEAKING_PART_TYPES = [
  "speaking-part-1",
  "speaking-part-2-cue",
  "speaking-part-3",
] as const;
export type SpeakingPartType = (typeof SPEAKING_PART_TYPES)[number];

export function isSpeakingPartType(s: string): s is SpeakingPartType {
  return (SPEAKING_PART_TYPES as readonly string[]).includes(s);
}

// ─── Parser ──────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function asStringArray(v: unknown, min: number): string[] | null {
  if (!Array.isArray(v) || v.length < min) return null;
  if (
    !v.every((x): x is string => typeof x === "string" && x.trim().length > 0)
  ) {
    return null;
  }
  return v;
}

function parsePart1(raw: unknown): SpeakingPart1 | null {
  if (!isObject(raw)) return null;
  const theme = asNonEmptyString(raw.theme);
  if (!theme) return null;
  if (!Array.isArray(raw.subtopics) || raw.subtopics.length === 0) return null;
  const subtopics: SpeakingPart1Subtopic[] = [];
  for (const s of raw.subtopics) {
    if (!isObject(s)) return null;
    const topic = asNonEmptyString(s.topic);
    const questions = asStringArray(s.questions, 1);
    if (!topic || !questions) return null;
    subtopics.push({ topic, questions });
  }
  return { theme, subtopics };
}

function parsePart2(raw: unknown): SpeakingPart2 | null {
  if (!isObject(raw)) return null;
  const cue_card_topic = asNonEmptyString(raw.cue_card_topic);
  const bullets = asStringArray(raw.bullets, 1);
  const final_prompt = asNonEmptyString(raw.final_prompt);
  const followup_questions = asStringArray(raw.followup_questions, 1);
  if (!cue_card_topic || !bullets || !final_prompt || !followup_questions) {
    return null;
  }
  return { cue_card_topic, bullets, final_prompt, followup_questions };
}

function parsePart3(raw: unknown): SpeakingPart3 | null {
  if (!isObject(raw)) return null;
  const theme = asNonEmptyString(raw.theme);
  const questions = asStringArray(raw.questions, 1);
  if (!theme || !questions) return null;
  return { theme, questions };
}

export function parseSpeakingContent(raw: unknown): SpeakingContent | null {
  if (!isObject(raw)) return null;
  const topic_domain = asNonEmptyString(raw.topic_domain);
  const part1 = parsePart1(raw.part1);
  const part2 = parsePart2(raw.part2);
  const part3 = parsePart3(raw.part3);
  if (!topic_domain || !part1 || !part2 || !part3) return null;
  return { topic_domain, part1, part2, part3 };
}

// ─── Render helpers ──────────────────────────────────────────────────────

// The cue card as the examiner shows it to the candidate — the canonical
// "Describe … / You should say: / and …" block. Used by the moderation
// review page and the Phase 2 runner.
export function renderCueCard(part2: SpeakingPart2): string {
  return [
    part2.cue_card_topic,
    "",
    "You should say:",
    ...part2.bullets.map((b) => `  • ${b}`),
    "",
    part2.final_prompt,
  ].join("\n");
}
