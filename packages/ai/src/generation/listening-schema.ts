// Zod schema for the canonical Listening-generation response.
//
// Contract source: prompts/generation/listening.md. Every generation call
// must produce JSON that parses through `generatedListeningSchema`. The
// pipeline retries once with a stricter nudge on failure, then surfaces a
// clean error rather than fabricate a section.
//
// The schema mirrors the parsed ListeningContent shape in `listening/
// content.ts` plus the Question-row shape in `listening/question-types.ts`.
// Cross-field invariants (slot_id global uniqueness, position uniqueness,
// completion_blank → block reference) live in `listening-validate.ts`.

import { z } from "zod";

const trackSchema = z.union([
  z.literal("Academic"),
  z.literal("GeneralTraining"),
]);
const difficultySchema = z.number().int().min(1).max(5);

// ─── Speakers + segments ────────────────────────────────────────────────

const accentSchema = z.enum([
  "british",
  "american",
  "australian",
  "canadian",
  "new-zealand",
]);
const speakerRoleSchema = z.enum(["narrator", "examiner", "speaker"]);

const speakerSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  role: speakerRoleSchema,
  accent: accentSchema,
});

const narrationSegmentSchema = z.object({
  kind: z.literal("narration"),
  text: z.string().min(1).max(2000),
});

const speechSegmentSchema = z.object({
  kind: z.literal("speech"),
  speaker_id: z.string().min(1).max(40),
  text: z.string().min(1).max(2000),
});

const readingPauseSegmentSchema = z.object({
  kind: z.literal("reading-pause"),
  // Real IELTS pauses are 20-45 seconds.
  seconds: z.number().int().min(5).max(120),
  instruction: z.string().min(1).max(400).optional(),
});

const questionsPreviewSegmentSchema = z.object({
  kind: z.literal("questions-preview"),
  seconds: z.number().int().min(5).max(120),
  question_positions: z.array(z.number().int().min(0).max(60)).min(1).max(20),
});

const segmentSchema = z.discriminatedUnion("kind", [
  narrationSegmentSchema,
  speechSegmentSchema,
  readingPauseSegmentSchema,
  questionsPreviewSegmentSchema,
]);

// ─── Completion blocks ──────────────────────────────────────────────────

const completionLayoutSchema = z.enum(["form", "notes", "table"]);

// LLMs frequently shorten "text" cells into bare strings ("Surname:")
// instead of the canonical {kind:"text", text:"Surname:"} object. Coerce
// here so a perfectly fine generation isn't thrown away over JSON shape
// quirks. The transform persists the object form, so downstream
// consumers (the runtime parser, the player, the grader) always see
// the canonical shape.
const segmentCellSchema = z.preprocess(
  (v) =>
    typeof v === "string"
      ? { kind: "text", text: v }
      : v,
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("text"),
      text: z.string().min(1).max(400),
    }),
    z.object({
      kind: z.literal("blank"),
      slot_id: z.string().min(1).max(40),
    }),
  ]),
);

const completionRowSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  is_header: z.boolean().optional(),
  cells: z.array(z.array(segmentCellSchema).min(1)).min(1).max(8),
});

const completionBlockSchema = z.object({
  id: z.string().min(1).max(40),
  layout: completionLayoutSchema,
  title: z.string().min(1).max(120).optional(),
  instructions: z.string().min(1).max(400).optional(),
  rows: z.array(completionRowSchema).min(1).max(20),
});

// ─── Parts ──────────────────────────────────────────────────────────────

const partContextSchema = z.enum(["social", "academic"]);
const partNumberSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

const partSchema = z.object({
  part: partNumberSchema,
  context: partContextSchema,
  title: z.string().min(2).max(160),
  speakers: z.array(speakerSchema).min(1).max(6),
  transcript: z.array(segmentSchema).min(2).max(80),
  question_positions: z.array(z.number().int().min(0).max(60)).min(1).max(20),
  completion_blocks: z.array(completionBlockSchema).max(4).optional(),
});

// ─── Questions ──────────────────────────────────────────────────────────
//
// Discriminated union — each `type` literal pairs with its own
// `correct_answer` shape. Anything outside the Phase 3 supported set is
// rejected at the schema layer.

const mcqOptionSchema = z.object({
  id: z.string().min(1).max(2),
  text: z.string().min(1).max(400),
});

const mcqSingleAnswerSchema = z
  .object({
    options: z.array(mcqOptionSchema).min(2).max(6),
    correct: z.string().min(1).max(2),
  })
  .refine(
    (v) => v.options.some((o) => o.id === v.correct),
    "mcq-single correct must match one of the option ids.",
  );

const mcqMultiAnswerSchema = z
  .object({
    options: z.array(mcqOptionSchema).min(3).max(8),
    pick_count: z.number().int().min(2).max(5),
    correct: z.array(z.string().min(1).max(2)).min(2).max(5),
  })
  .refine(
    (v) => v.pick_count === v.correct.length,
    "mcq-multi pick_count must equal correct.length.",
  )
  .refine(
    (v) => new Set(v.correct).size === v.correct.length,
    "mcq-multi correct must not contain duplicates.",
  )
  .refine(
    (v) => v.correct.every((id) => v.options.some((o) => o.id === id)),
    "mcq-multi correct must only reference defined option ids.",
  )
  .refine(
    (v) => v.pick_count < v.options.length,
    "mcq-multi pick_count must be strictly less than options.length (need at least one distractor).",
  );

const sentenceCompletionAnswerSchema = z
  .object({
    stem: z.string().min(3).max(400),
    word_limit: z.number().int().min(1).max(10),
    accepted: z.array(z.string().min(1).max(80)).min(1).max(6),
  })
  .refine(
    (v) => v.stem.includes("___"),
    "Stem must contain ___ marking the blank.",
  );

const shortAnswerAnswerSchema = z.object({
  word_limit: z.number().int().min(1).max(10),
  accepted: z.array(z.string().min(1).max(80)).min(1).max(6),
});

const completionBlankAnswerSchema = z.object({
  block_id: z.string().min(1).max(40),
  slot_id: z.string().min(1).max(40),
  word_limit: z.number().int().min(1).max(10),
  accepted: z.array(z.string().min(1).max(80)).min(1).max(6),
});

const questionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("listening-mcq-single"),
    position: z.number().int().min(0).max(60),
    prompt: z.string().min(3).max(800),
    points: z.number().int().min(1).max(2).default(1),
    correct_answer: mcqSingleAnswerSchema,
  }),
  z.object({
    type: z.literal("listening-mcq-multi"),
    position: z.number().int().min(0).max(60),
    prompt: z.string().min(3).max(800),
    points: z.number().int().min(2).max(5).default(2),
    correct_answer: mcqMultiAnswerSchema,
  }),
  z.object({
    type: z.literal("listening-sentence-completion"),
    position: z.number().int().min(0).max(60),
    prompt: z.string().min(3).max(800),
    points: z.number().int().min(1).max(1).default(1),
    correct_answer: sentenceCompletionAnswerSchema,
  }),
  z.object({
    type: z.literal("listening-short-answer"),
    position: z.number().int().min(0).max(60),
    prompt: z.string().min(3).max(800),
    points: z.number().int().min(1).max(1).default(1),
    correct_answer: shortAnswerAnswerSchema,
  }),
  z.object({
    type: z.literal("listening-completion-blank"),
    position: z.number().int().min(0).max(60),
    prompt: z.string().min(3).max(800),
    points: z.number().int().min(1).max(1).default(1),
    correct_answer: completionBlankAnswerSchema,
  }),
]);

// ─── Top-level shape ────────────────────────────────────────────────────

export const generatedListeningSchema = z
  .object({
    track: trackSchema,
    difficulty: difficultySchema,
    parts: z
      .array(partSchema)
      .length(4, "A Listening section must have exactly 4 parts."),
    questions: z.array(questionSchema).min(12).max(40),
  })
  .strict()
  .refine(
    (v) => v.parts.map((p) => p.part).every((n, i) => n === i + 1),
    "Parts must be in order: part 1, 2, 3, 4.",
  );

export type GeneratedListening = z.infer<typeof generatedListeningSchema>;
export type GeneratedListeningQuestion = z.infer<typeof questionSchema>;
export type GeneratedListeningPart = z.infer<typeof partSchema>;
export type GeneratedListeningSpeaker = z.infer<typeof speakerSchema>;
export type GeneratedListeningSegment = z.infer<typeof segmentSchema>;
export type GeneratedListeningCompletionBlock = z.infer<
  typeof completionBlockSchema
>;

export type ParseResult =
  | { ok: true; value: GeneratedListening }
  | { ok: false; issues: z.ZodIssue[]; raw: string };

export function parseGeneratedListening(raw: string): ParseResult {
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
  const result = generatedListeningSchema.safeParse(parsed);
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
