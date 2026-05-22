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
    | "prompt.preamble-too-long"
    | "letter.wrong-bullet-count"
    | "letter.missing-no-addresses-line"
    | "letter.missing-begin-letter-line"
    | "letter.missing-salutation"
    | "letter.register-salutation-mismatch"
    | "task2.subtype-instruction-mismatch"
    | "visual.kind-mismatch"
    | "visual.out-of-contract-range"
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
const T1_ACADEMIC_INSTRUCTION =
  /summarise\s+the\s+information\s+by\s+selecting\s+and\s+reporting\s+the\s+main\s+features,\s+and\s+make\s+comparisons\s+where\s+relevant\.?/i;
const NO_ADDRESSES_LINE = /you\s+do\s+not\s+need\s+to\s+write\s+any\s+addresses\./i;
const BEGIN_LETTER_LINE = /begin\s+your\s+letter\s+as\s+follows:/i;
const FORMAL_SALUTATION = /dear\s+sir\s+or\s+madam,/i;
const SEMI_FORMAL_SALUTATION =
  /dear\s+(mr|mrs|ms|miss|dr|prof)\s+[a-z][a-z' -]*,/i;
const INFORMAL_SALUTATION =
  /dear\s+(?!sir\s+or\s+madam)(?!(mr|mrs|ms|miss|dr|prof)\b)[a-z][a-z' -]*,/i;
const TASK2_GIVE_REASONS_LINE =
  /give\s+reasons\s+for\s+your\s+answer\s+and\s+include\s+any\s+relevant\s+examples\s+from\s+your\s+own\s+knowledge\s+or\s+experience\.?/i;
const TASK2_DISCUSSION_INSTRUCTION =
  /discuss\s+both\s+views\s+and\s+give\s+your\s+own\s+opinion[\.\?]/i;
const TASK2_TWO_PART_PATTERN =
  /(Why|What|How)[^?]*\?\s*\n\s*\n\s*(Why|What|How)[^?]*\?/i;

function hasWordTarget(prompt: string, re: RegExp): boolean {
  return re.test(prompt);
}

function countBullets(prompt: string): number {
  // Canonical GT letter prompts list exactly three bullets, each on its
  // own line starting with a dash or bullet glyph.
  const matches = prompt.match(/^\s*[-•]\s+\S/gm);
  return matches ? matches.length : 0;
}

function sentenceCount(text: string): number {
  return text
    .split(/[.!?]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean).length;
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
  const instructionMatch = T1_ACADEMIC_INSTRUCTION.exec(value.prompt);
  if (!instructionMatch) {
    issues.push({
      code: "prompt.missing-instruction",
      message:
        "Task 1 Academic prompt is missing the canonical 'Summarise the information ... main features ... make comparisons where relevant.' instruction.",
      });
  } else {
    const preamble = value.prompt.slice(0, instructionMatch.index).trim();
    if (preamble.length > 0 && sentenceCount(preamble) > 2) {
      issues.push({
        code: "prompt.preamble-too-long",
        message:
          "Task 1 Academic prompt preamble must stay within 1-2 short sentences before the canonical instruction.",
      });
    }
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
      if (visual.series.length < 2 || visual.series.length > 5) {
        issues.push({
          code: "visual.out-of-contract-range",
          message: `Bar charts must have 2-5 series; found ${visual.series.length}.`,
        });
        return;
      }
      if (visual.categories.length < 3 || visual.categories.length > 7) {
        issues.push({
          code: "visual.out-of-contract-range",
          message: `Bar charts must have 3-7 categories; found ${visual.categories.length}.`,
        });
        return;
      }
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
      if (visual.series.length < 2 || visual.series.length > 5) {
        issues.push({
          code: "visual.out-of-contract-range",
          message: `Line charts must have 2-5 series; found ${visual.series.length}.`,
        });
        return;
      }
      if (visual.x_values.length < 3 || visual.x_values.length > 7) {
        issues.push({
          code: "visual.out-of-contract-range",
          message: `Line charts must have 3-7 x-values; found ${visual.x_values.length}.`,
        });
        return;
      }
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
      if (visual.headers.length < 3 || visual.headers.length > 5) {
        issues.push({
          code: "visual.out-of-contract-range",
          message: `Tables must have 3-5 columns; found ${visual.headers.length}.`,
        });
        return;
      }
      if (visual.rows.length < 3 || visual.rows.length > 8) {
        issues.push({
          code: "visual.out-of-contract-range",
          message: `Tables must have 3-8 rows; found ${visual.rows.length}.`,
        });
        return;
      }
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
      if (visual.slices.length < 3 || visual.slices.length > 6) {
        issues.push({
          code: "visual.out-of-contract-range",
          message: `Pie charts must have 3-6 slices; found ${visual.slices.length}.`,
        });
        return;
      }
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
      if (visual.steps.length < 4 || visual.steps.length > 7) {
        issues.push({
          code: "visual.out-of-contract-range",
          message: `Process diagrams must have 4-7 steps; found ${visual.steps.length}.`,
        });
      }
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
  if (!NO_ADDRESSES_LINE.test(value.prompt)) {
    issues.push({
      code: "letter.missing-no-addresses-line",
      message:
        "Letter prompt is missing the canonical 'You do NOT need to write any addresses.' line.",
    });
  }
  if (!BEGIN_LETTER_LINE.test(value.prompt)) {
    issues.push({
      code: "letter.missing-begin-letter-line",
      message:
        "Letter prompt is missing the canonical 'Begin your letter as follows:' line.",
    });
  }
  if (!/dear\s+\S/i.test(value.prompt)) {
    issues.push({
      code: "letter.missing-salutation",
      message: "Letter prompt does not include a 'Dear ...,' salutation line.",
    });
  } else if (!salutationMatchesRegister(value.prompt, value.body_meta.register)) {
    issues.push({
      code: "letter.register-salutation-mismatch",
      message: `Letter salutation does not match the declared ${value.body_meta.register} register.`,
    });
  }
}

function salutationMatchesRegister(
  prompt: string,
  register: GeneratedWritingTask1General["body_meta"]["register"],
): boolean {
  switch (register) {
    case "formal":
      return FORMAL_SALUTATION.test(prompt);
    case "semi-formal":
      return SEMI_FORMAL_SALUTATION.test(prompt);
    case "informal":
      return INFORMAL_SALUTATION.test(prompt);
  }
}

function subtypeInstructionMatches(
  value: GeneratedWritingTask2,
): boolean {
  switch (value.body_meta.question_subtype) {
    case "opinion":
      return /to\s+what\s+extent\s+do\s+you\s+agree\s+or\s+disagree\?/i.test(
        value.prompt,
      );
    case "discussion":
      return TASK2_DISCUSSION_INSTRUCTION.test(value.prompt);
    case "problem-solution":
      return /what\s+are\s+the\s+causes\s+of\s+this\s+problem\s+and\s+what\s+measures\s+could\s+be\s+taken\s+to\s+address\s+it\?/i.test(
        value.prompt,
      );
    case "advantage-disadvantage":
      return /do\s+the\s+advantages\s+outweigh\s+the\s+disadvantages\?/i.test(
        value.prompt,
      );
    case "two-part": {
      const beforeReasons = value.prompt.split(/give\s+reasons/i)[0] ?? value.prompt;
      return TASK2_TWO_PART_PATTERN.test(beforeReasons);
    }
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
  if (!TASK2_GIVE_REASONS_LINE.test(value.prompt)) {
    issues.push({
      code: "prompt.missing-instruction",
      message:
        "Task 2 prompt is missing the canonical 'Give reasons for your answer ...' instruction.",
    });
  }
  if (!subtypeInstructionMatches(value)) {
    issues.push({
      code: "task2.subtype-instruction-mismatch",
      message: `Task 2 prompt does not match the declared ${value.body_meta.question_subtype} question subtype.`,
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
