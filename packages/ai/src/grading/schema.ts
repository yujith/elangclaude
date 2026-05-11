// Zod schema for the canonical Writing-grading response.
//
// Contract source: .claude/skills/ai-grading/SKILL.md. Every grading prompt
// must produce JSON that parses through `writingGradeSchema`. The route
// handler validates the model's output against this — if it fails, we
// retry once with a stricter response format, then surface a clean error
// rather than fabricate a score.

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
  // Evidence keeps Claude honest — no hand-wavy "good vocabulary" scores.
  evidence: z.string().min(1, "Evidence must quote the response."),
});

export const writingGradeSchema = z
  .object({
    band_overall: halfBand,
    criteria: z.object({
      task_achievement: criterion,
      coherence_cohesion: criterion,
      lexical_resource: criterion,
      grammatical_range: criterion,
    }),
    strengths: z.array(z.string().min(5)).min(2).max(4),
    improvements: z.array(z.string().min(5)).min(2).max(4),
    next_drill: z.string().min(3),
  })
  .strict();

export type WritingGrade = z.infer<typeof writingGradeSchema>;

// Helper for the route handler. Returns a discriminated result so the caller
// can decide whether to retry, surface, or persist.
export type ParseResult =
  | { ok: true; grade: WritingGrade }
  | { ok: false; issues: z.ZodIssue[]; raw: string };

export function parseWritingGrade(raw: string): ParseResult {
  // Provider responses may include preamble like "Here is the grade: { ... }"
  // even when prompted not to. Extract the first JSON object before parsing.
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
  const result = writingGradeSchema.safeParse(parsed);
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
