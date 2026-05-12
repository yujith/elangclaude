// Zod schema for the canonical Reading-generation response.
//
// Contract source: prompts/generation/reading.md. Every generation call
// must produce JSON that parses through `generatedReadingSchema`. The
// pipeline retries once with a stricter nudge on failure, then surfaces
// a clean error rather than fabricate a passage.

import { z } from "zod";

const trackSchema = z.union([z.literal("Academic"), z.literal("GeneralTraining")]);
const difficultySchema = z.number().int().min(1).max(5);
const labelSchema = z.string().min(1).max(2);

const paragraphSchema = z.object({
  label: labelSchema,
  text: z.string().min(80).max(2400),
});

const mcqOptionSchema = z.object({
  id: z.string().min(1).max(2),
  text: z.string().min(1).max(400),
});

const mcqAnswerSchema = z
  .object({
    options: z.array(mcqOptionSchema).min(2).max(6),
    correct: z.string().min(1).max(2),
  })
  .refine(
    (v) => v.options.some((o) => o.id === v.correct),
    "MCQ correct must match one of the option ids.",
  );

const tfngAnswerSchema = z.object({
  correct: z.enum(["true", "false", "not given"]),
});

const ynngAnswerSchema = z.object({
  correct: z.enum(["yes", "no", "not given"]),
});

const sentenceCompletionAnswerSchema = z
  .object({
    stem: z.string().min(3).max(400),
    word_limit: z.number().int().min(1).max(5),
    accepted: z.array(z.string().min(1).max(80)).min(1).max(5),
  })
  .refine((v) => v.stem.includes("___"), "Stem must contain ___ marking the blank.");

const shortAnswerAnswerSchema = z.object({
  word_limit: z.number().int().min(1).max(5),
  accepted: z.array(z.string().min(1).max(80)).min(1).max(5),
});

// Discriminated union — each `type` literal pairs with its own
// `correct_answer` shape. Anything outside the Phase 5 supported set is
// rejected at the schema layer.
const questionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reading-mcq"),
    position: z.number().int().min(0).max(40),
    prompt: z.string().min(3).max(800),
    correct_answer: mcqAnswerSchema,
  }),
  z.object({
    type: z.literal("reading-true-false-not-given"),
    position: z.number().int().min(0).max(40),
    prompt: z.string().min(3).max(800),
    correct_answer: tfngAnswerSchema,
  }),
  z.object({
    type: z.literal("reading-yes-no-not-given"),
    position: z.number().int().min(0).max(40),
    prompt: z.string().min(3).max(800),
    correct_answer: ynngAnswerSchema,
  }),
  z.object({
    type: z.literal("reading-sentence-completion"),
    position: z.number().int().min(0).max(40),
    prompt: z.string().min(3).max(800),
    correct_answer: sentenceCompletionAnswerSchema,
  }),
  z.object({
    type: z.literal("reading-short-answer"),
    position: z.number().int().min(0).max(40),
    prompt: z.string().min(3).max(800),
    correct_answer: shortAnswerAnswerSchema,
  }),
]);

const gtContextSchema = z.enum([
  "social-survival",
  "workplace",
  "general-reading",
]);

export const generatedReadingSchema = z
  .object({
    track: trackSchema,
    difficulty: difficultySchema,
    passage: z.object({
      title: z.string().min(2).max(160).optional(),
      paragraphs: z.array(paragraphSchema).min(3).max(8),
      // Optional for backward compat. Only meaningful when track is
      // GeneralTraining; on Academic outputs we ignore it downstream.
      gt_context: gtContextSchema.optional(),
    }),
    questions: z.array(questionSchema).min(4).max(12),
  })
  .strict();

export type GeneratedReading = z.infer<typeof generatedReadingSchema>;
export type GeneratedReadingQuestion = z.infer<typeof questionSchema>;

// Result discriminator mirroring parseWritingGrade. The pipeline retries
// once on parse failure, then surfaces a typed error to the caller.
export type ParseResult =
  | { ok: true; value: GeneratedReading }
  | { ok: false; issues: z.ZodIssue[]; raw: string };

export function parseGeneratedReading(raw: string): ParseResult {
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
  const result = generatedReadingSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, issues: result.error.issues, raw };
  }
  return { ok: true, value: result.data };
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
