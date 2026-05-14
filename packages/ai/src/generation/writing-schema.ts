// Zod schema for the canonical Writing-generation response.
//
// Contract source: prompts/generation/writing.md. Every generation call
// must produce JSON that parses through `generatedWritingSchema`. The
// pipeline retries once with a stricter nudge on failure, then surfaces
// a clean error rather than fabricate a task.
//
// The discriminator is `task_kind`. The three variants share `prompt`,
// `track`, and `difficulty` but carry different `body_meta` shapes —
// and only Task 1 Academic carries a `visual`.
//
// The visual shape mirrors apps/web/lib/writing/visual.ts (the render
// contract). If you change one, change the other; tests in both packages
// will catch drift.
//
// Note: ParseResult is exported via the unique alias `WritingParseResult`
// so it does not collide with the Reading equivalent in schema.ts.

import { z } from "zod";

const trackSchema = z.union([
  z.literal("Academic"),
  z.literal("GeneralTraining"),
]);
const difficultySchema = z.number().int().min(1).max(5);

// ─── Visual shapes (mirror of apps/web/lib/writing/visual.ts) ────────────

const seriesSchema = z.object({
  name: z.string().min(1).max(80),
  values: z.array(z.number().finite()).min(1).max(20),
});

const barVisualSchema = z.object({
  kind: z.literal("bar"),
  title: z.string().min(1).max(160).optional(),
  x_label: z.string().min(1).max(80).optional(),
  y_label: z.string().min(1).max(80).optional(),
  unit: z.string().min(1).max(16).optional(),
  categories: z.array(z.string().min(1).max(60)).min(2).max(12),
  series: z.array(seriesSchema).min(1).max(5),
});

const lineVisualSchema = z.object({
  kind: z.literal("line"),
  title: z.string().min(1).max(160).optional(),
  x_label: z.string().min(1).max(80).optional(),
  y_label: z.string().min(1).max(80).optional(),
  unit: z.string().min(1).max(16).optional(),
  x_values: z.array(z.string().min(1).max(60)).min(2).max(20),
  series: z.array(seriesSchema).min(1).max(5),
});

const pieVisualSchema = z.object({
  kind: z.literal("pie"),
  title: z.string().min(1).max(160).optional(),
  unit: z.string().min(1).max(16).optional(),
  slices: z
    .array(
      z.object({
        label: z.string().min(1).max(60),
        value: z.number().finite().nonnegative(),
      }),
    )
    .min(2)
    .max(8),
});

const tableVisualSchema = z.object({
  kind: z.literal("table"),
  title: z.string().min(1).max(160).optional(),
  headers: z.array(z.string().min(1).max(60)).min(2).max(8),
  rows: z
    .array(
      z
        .array(z.union([z.string().min(0).max(60), z.number().finite()]))
        .min(2)
        .max(8),
    )
    .min(2)
    .max(12),
});

const processVisualSchema = z.object({
  kind: z.literal("process"),
  title: z.string().min(1).max(160).optional(),
  steps: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        detail: z.string().min(1).max(240).optional(),
      }),
    )
    .min(3)
    .max(10),
});

const visualSchema = z.discriminatedUnion("kind", [
  barVisualSchema,
  lineVisualSchema,
  pieVisualSchema,
  tableVisualSchema,
  processVisualSchema,
]);

// ─── body_meta per task_kind ─────────────────────────────────────────────

const academicBodyMetaSchema = z.object({
  visual_kind: z.enum(["bar", "line", "pie", "table", "process"]),
  topic: z.string().min(2).max(80),
});

const generalBodyMetaSchema = z.object({
  register: z.enum(["formal", "semi-formal", "informal"]),
  audience: z.string().min(2).max(80),
  scenario_topic: z.string().min(2).max(80),
});

const task2BodyMetaSchema = z.object({
  question_subtype: z.enum([
    "opinion",
    "discussion",
    "problem-solution",
    "advantage-disadvantage",
    "two-part",
  ]),
  topic: z.string().min(2).max(80),
});

// ─── Per-task-kind schemas ───────────────────────────────────────────────

// The `body_meta.visual_kind === visual.kind` consistency check lives in
// the semantic validator, not here: z.discriminatedUnion requires plain
// ZodObject branches, and a `.refine()` would wrap this in ZodEffects.
const task1AcademicSchema = z
  .object({
    task_kind: z.literal("writing-task-1-academic"),
    track: z.literal("Academic"),
    difficulty: difficultySchema,
    prompt: z.string().min(80).max(2400),
    body_meta: academicBodyMetaSchema,
    visual: visualSchema,
  })
  .strict();

const task1GeneralSchema = z
  .object({
    task_kind: z.literal("writing-task-1-general"),
    track: z.literal("GeneralTraining"),
    difficulty: difficultySchema,
    prompt: z.string().min(120).max(2400),
    body_meta: generalBodyMetaSchema,
  })
  .strict();

const task2Schema = z
  .object({
    task_kind: z.literal("writing-task-2"),
    track: trackSchema,
    difficulty: difficultySchema,
    prompt: z.string().min(80).max(2400),
    body_meta: task2BodyMetaSchema,
  })
  .strict();

// Discriminated union by task_kind. Each branch carries its own track
// constraint via z.literal above, so a mismatched track is rejected at
// the schema layer rather than slipping through to the validator.
export const generatedWritingSchema = z.discriminatedUnion("task_kind", [
  task1AcademicSchema,
  task1GeneralSchema,
  task2Schema,
]);

export type GeneratedWriting = z.infer<typeof generatedWritingSchema>;
export type GeneratedWritingTask1Academic = z.infer<typeof task1AcademicSchema>;
export type GeneratedWritingTask1General = z.infer<typeof task1GeneralSchema>;
export type GeneratedWritingTask2 = z.infer<typeof task2Schema>;
export type GeneratedWritingVisual = z.infer<typeof visualSchema>;

export type WritingParseResult =
  | { ok: true; value: GeneratedWriting }
  | { ok: false; issues: z.ZodIssue[]; raw: string };

export function parseGeneratedWriting(raw: string): WritingParseResult {
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
  const result = generatedWritingSchema.safeParse(parsed);
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
