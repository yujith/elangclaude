// Semantic validator for generated Writing content.
//
// The Zod schema catches structural mistakes. This module catches the
// content mistakes the schema cannot: a task prompt missing its
// word-target line, a letter prompt without the canonical three
// bullets, a visual whose series lengths don't line up with its axis.
//
// A failure here rejects the whole generation; the caller re-rolls.
// Issue codes are stable so the SuperAdmin UI can group by code.

import type {
  GeneratedWriting,
  GeneratedWritingTask1Academic,
  GeneratedWritingTask1General,
  GeneratedWritingTask2,
  GeneratedWritingVisual,
} from "./writing-schema";

export type WritingValidationIssue = {
  code:
    | "prompt.missing-word-target"
    | "prompt.missing-instruction"
    | "letter.wrong-bullet-count"
    | "letter.missing-salutation"
    | "visual.kind-mismatch"
    | "visual.series-length-mismatch"
    | "visual.table-row-width-mismatch"
    | "visual.pie-sum-implausible";
  message: string;
};

export type WritingValidationResult =
  | { ok: true }
  | { ok: false; issues: WritingValidationIssue[] };

// IELTS word-target lines are fixed strings. We match case-insensitively
// and tolerate any run of whitespace so a stray double space doesn't
// reject an otherwise-good task.
const T1_WORD_TARGET = /write\s+at\s+least\s+150\s+words/i;
const T2_WORD_TARGET = /write\s+at\s+least\s+250\s+words/i;

function hasWordTarget(prompt: string, re: RegExp): boolean {
  return re.test(prompt);
}

function countBullets(prompt: string): number {
  // Canonical GT letter prompts list exactly three bullets, each on its
  // own line starting with a dash or bullet glyph.
  const matches = prompt.match(/^\s*[-•]\s+\S/gm);
  return matches ? matches.length : 0;
}

function validateTask1Academic(
  value: GeneratedWritingTask1Academic,
  issues: WritingValidationIssue[],
): void {
  if (!hasWordTarget(value.prompt, T1_WORD_TARGET)) {
    issues.push({
      code: "prompt.missing-word-target",
      message: "Task 1 prompt does not contain 'Write at least 150 words'.",
    });
  }
  // The canonical Academic T1 instruction. We check for the distinctive
  // phrase rather than the whole sentence so minor punctuation drift
  // doesn't reject a good task.
  if (!/main\s+features/i.test(value.prompt)) {
    issues.push({
      code: "prompt.missing-instruction",
      message:
        "Task 1 Academic prompt is missing the canonical 'main features' instruction.",
    });
  }
  // body_meta.visual_kind must agree with the actual visual.kind. The
  // schema can't enforce this cross-field rule inside a discriminated
  // union, so it lives here.
  if (value.body_meta.visual_kind !== value.visual.kind) {
    issues.push({
      code: "visual.kind-mismatch",
      message: `body_meta.visual_kind is "${value.body_meta.visual_kind}" but visual.kind is "${value.visual.kind}".`,
    });
  }
  validateVisual(value.visual, issues);
}

function validateVisual(
  visual: GeneratedWritingVisual,
  issues: WritingValidationIssue[],
): void {
  switch (visual.kind) {
    case "bar": {
      for (const s of visual.series) {
        if (s.values.length !== visual.categories.length) {
          issues.push({
            code: "visual.series-length-mismatch",
            message: `Bar series "${s.name}" has ${s.values.length} values but there are ${visual.categories.length} categories.`,
          });
          return;
        }
      }
      return;
    }
    case "line": {
      for (const s of visual.series) {
        if (s.values.length !== visual.x_values.length) {
          issues.push({
            code: "visual.series-length-mismatch",
            message: `Line series "${s.name}" has ${s.values.length} values but there are ${visual.x_values.length} x-values.`,
          });
          return;
        }
      }
      return;
    }
    case "table": {
      for (let i = 0; i < visual.rows.length; i++) {
        const row = visual.rows[i]!;
        if (row.length !== visual.headers.length) {
          issues.push({
            code: "visual.table-row-width-mismatch",
            message: `Table row ${i} has ${row.length} cells but there are ${visual.headers.length} headers.`,
          });
          return;
        }
      }
      return;
    }
    case "pie": {
      // When the pie is expressed in percentages the slices should sum
      // to roughly 100. We allow a ±5 band for rounding. Pies without a
      // "%" unit are absolute counts and need no sum check.
      if (visual.unit === "%") {
        const sum = visual.slices.reduce((acc, s) => acc + s.value, 0);
        if (sum < 95 || sum > 105) {
          issues.push({
            code: "visual.pie-sum-implausible",
            message: `Pie slices sum to ${sum}% — expected ~100%.`,
          });
        }
      }
      return;
    }
    case "process":
      // Step ordering and labels are schema-checked; nothing semantic
      // left to verify here.
      return;
  }
}

function validateTask1General(
  value: GeneratedWritingTask1General,
  issues: WritingValidationIssue[],
): void {
  if (!hasWordTarget(value.prompt, T1_WORD_TARGET)) {
    issues.push({
      code: "prompt.missing-word-target",
      message: "Letter prompt does not contain 'Write at least 150 words'.",
    });
  }
  const bullets = countBullets(value.prompt);
  if (bullets !== 3) {
    issues.push({
      code: "letter.wrong-bullet-count",
      message: `Letter prompt has ${bullets} bullet point(s); the canonical GT format has exactly 3.`,
    });
  }
  if (!/dear\s+\S/i.test(value.prompt)) {
    issues.push({
      code: "letter.missing-salutation",
      message: "Letter prompt does not include a 'Dear ...,' salutation line.",
    });
  }
}

function validateTask2(
  value: GeneratedWritingTask2,
  issues: WritingValidationIssue[],
): void {
  if (!hasWordTarget(value.prompt, T2_WORD_TARGET)) {
    issues.push({
      code: "prompt.missing-word-target",
      message: "Task 2 prompt does not contain 'Write at least 250 words'.",
    });
  }
  // Every Task 2 prompt ends with the standard "Give reasons ..." line.
  if (!/give\s+reasons/i.test(value.prompt)) {
    issues.push({
      code: "prompt.missing-instruction",
      message:
        "Task 2 prompt is missing the canonical 'Give reasons for your answer ...' instruction.",
    });
  }
}

export function validateGeneratedWriting(
  value: GeneratedWriting,
): WritingValidationResult {
  const issues: WritingValidationIssue[] = [];

  switch (value.task_kind) {
    case "writing-task-1-academic":
      validateTask1Academic(value, issues);
      break;
    case "writing-task-1-general":
      validateTask1General(value, issues);
      break;
    case "writing-task-2":
      validateTask2(value, issues);
      break;
  }

  if (issues.length === 0) return { ok: true };
  return { ok: false, issues };
}
