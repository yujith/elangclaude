// Zod schema for the canonical Speaking-grading response.
//
// Contract source: .claude/skills/ai-grading/SKILL.md + the IELTS Speaking
// criteria in .claude/skills/ielts-domain/SKILL.md. Every grading prompt
// must produce JSON that parses through `speakingGradeSchema`. The route
// handler validates the model's output against this — if it fails, we
// retry once with a stricter response format, then surface a clean error
// rather than fabricate a score.
//
// Shape mirrors writingGradeSchema (half-band refine, justification length,
// evidence requirement, 2–4 strengths and improvements, next_drill tag).
// The only differences are the four criterion keys: fluency_coherence,
// lexical_resource, grammatical_range, pronunciation.

import { z } from "zod";

// IELTS bands are 0–9 in half-band increments only. 7.3 is not a band.
const halfBand = z
  .number()
  .min(0)
  .max(9)
  .refine((n) => Number.isInteger(n * 2), {
    message: "Band must be a half-band (0, 0.5, 1.0, ..., 9.0).",
  });

const criterion = z.object({
  band: halfBand,
  justification: z.string().min(20, "Justification must be specific."),
  // Evidence keeps Claude honest — no hand-wavy "good fluency" scores.
  // For Speaking, evidence is a transcript quote OR an audio-feature
  // citation (e.g. "wpm=89 below 110–140 comfort range").
  evidence: z
    .string()
    .min(1, "Evidence must quote the transcript or cite an audio feature."),
});

export const speakingGradeSchema = z
  .object({
    band_overall: halfBand,
    criteria: z.object({
      fluency_coherence: criterion,
      lexical_resource: criterion,
      grammatical_range: criterion,
      pronunciation: criterion,
    }),
    strengths: z.array(z.string().min(5)).min(2).max(4),
    improvements: z.array(z.string().min(5)).min(2).max(4),
    next_drill: z.string().min(3),
  })
  .strict();

export type SpeakingGrade = z.infer<typeof speakingGradeSchema>;

// Helper for the route handler. Returns a discriminated result so the
// caller can decide whether to retry, surface, or persist.
export type SpeakingParseResult =
  | { ok: true; grade: SpeakingGrade }
  | { ok: false; issues: z.ZodIssue[]; raw: string };

export function parseSpeakingGrade(raw: string): SpeakingParseResult {
  // Provider responses may include preamble even when told not to — pull
  // the first JSON object out before parsing.
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
  const result = speakingGradeSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, issues: result.error.issues, raw };
  }
  return { ok: true, grade: result.data };
}

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
