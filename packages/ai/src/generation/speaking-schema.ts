// Zod schema for the canonical Speaking-generation response.
//
// Contract source: prompts/generation/speaking.md. Every generation call
// must produce JSON that parses through `generatedSpeakingSchema`. The
// pipeline retries once with a stricter nudge on failure, then surfaces a
// clean error rather than fabricate a test.
//
// A Speaking "test" is the full ~12-min examiner script: Part 1 interview,
// Part 2 cue card, Part 3 discussion. See docs/adr/0006-speaking-data-shape.md.
// Unlike Writing there is no `task_kind` discriminator — there is one shape.
//
// The read-side parser in apps/web/lib/speaking/content.ts mirrors this
// shape by hand (no Zod dep in apps/web, per ADR 0003 D1). If you change one,
// change the other; tests in both packages will catch drift.

import { z } from "zod";

const trackSchema = z.union([
  z.literal("Academic"),
  z.literal("GeneralTraining"),
]);
const difficultySchema = z.number().int().min(1).max(5);

// ─── Part 1 — interview on familiar topics ───────────────────────────────

const part1SubtopicSchema = z
  .object({
    topic: z.string().min(2).max(60),
    // 3–4 short questions the examiner can ask within this sub-topic.
    questions: z.array(z.string().min(8).max(240)).min(3).max(4),
  })
  .strict();

const part1Schema = z
  .object({
    theme: z.string().min(3).max(80),
    // 3–4 familiar-topic clusters (hometown, work/study, hobbies, …).
    subtopics: z.array(part1SubtopicSchema).min(3).max(4),
  })
  .strict();

// ─── Part 2 — the cue card for the 1–2 min long turn ─────────────────────

const part2Schema = z
  .object({
    // The canonical cue-card line, e.g. "Describe a book you recently read."
    cue_card_topic: z.string().min(10).max(160),
    // The "You should say:" points — exactly 3–4 per the IELTS format.
    bullets: z.array(z.string().min(4).max(160)).min(3).max(4),
    // The reflective closing line, e.g. "and explain why you found it
    // memorable." (Begins with "and ".)
    final_prompt: z.string().min(8).max(200),
    // 1–2 short rounding-off questions the examiner asks after the long turn.
    followup_questions: z.array(z.string().min(8).max(200)).min(1).max(2),
  })
  .strict();

// ─── Part 3 — abstract discussion expanding on the Part 2 topic ──────────

const part3Schema = z
  .object({
    theme: z.string().min(3).max(80),
    // 4–6 abstract discussion questions.
    questions: z.array(z.string().min(10).max(240)).min(4).max(6),
  })
  .strict();

export const generatedSpeakingSchema = z
  .object({
    // Fixed marker — the model must echo it so a stray Writing/Reading
    // response is rejected at the schema layer.
    section: z.literal("speaking"),
    track: trackSchema,
    difficulty: difficultySchema,
    // 2–5 word noun phrase naming the overall thematic domain.
    topic_domain: z.string().min(2).max(80),
    part1: part1Schema,
    part2: part2Schema,
    part3: part3Schema,
  })
  .strict();

export type GeneratedSpeaking = z.infer<typeof generatedSpeakingSchema>;
export type GeneratedSpeakingPart1 = z.infer<typeof part1Schema>;
export type GeneratedSpeakingPart2 = z.infer<typeof part2Schema>;
export type GeneratedSpeakingPart3 = z.infer<typeof part3Schema>;

export type SpeakingParseResult =
  | { ok: true; value: GeneratedSpeaking }
  | { ok: false; issues: z.ZodIssue[]; raw: string };

export function parseGeneratedSpeaking(raw: string): SpeakingParseResult {
  const json = extractFirstJsonObject(raw);
  if (json === null) {
    return {
      ok: false,
      issues: [
        {
          code: "custom",
          path: [],
          message: "Response did not contain a JSON object.",
        },
      ],
      raw,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      ok: false,
      issues: [
        { code: "custom", path: [], message: "Response was not valid JSON." },
      ],
      raw,
    };
  }
  const result = generatedSpeakingSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, issues: result.error.issues, raw };
  }
  return { ok: true, value: result.data };
}

// Same first-JSON-object extractor as the Reading/Writing schemas — provider
// responses sometimes wrap the object in preamble even when told not to.
function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
