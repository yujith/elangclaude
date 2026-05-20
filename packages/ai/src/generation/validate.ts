// Semantic validator for generated Reading content.
//
// The Zod schema catches structural mistakes. This module catches the
// content mistakes that the schema cannot: a sentence-completion answer
// that's not actually in the passage, a MCQ where the correct option
// doesn't appear plausibly grounded in the passage, a passage length
// that falls outside the per-track window.
//
// Source-of-truth contract: docs/adr/0004-openrouter-reading-generate.md
// section D5. A failure here rejects the whole generation; the caller
// re-rolls.

import { softNormalize } from "../reading/normalize";
import type {
  GeneratedReading,
  GeneratedReadingQuestion,
} from "./schema";

export type ValidationIssue = {
  // Stable code for telemetry. The SuperAdmin UI can group by code.
  code:
    | "track.mismatch"
    | "passage.too-short"
    | "passage.too-long"
    | "passage.missing-gt-context"
    | "passage.too-few-paragraphs"
    | "passage.too-many-paragraphs"
    | "passage.invalid-paragraph-labels"
    | "questions.too-few"
    | "questions.too-many"
    | "questions.non-contiguous-positions"
    | "completion.answer-not-in-passage"
    | "short-answer.answer-not-in-passage"
    | "mcq.correct-not-grounded";
  // Human-readable message for logs.
  message: string;
  // Index into the questions array, when applicable.
  questionIndex?: number;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; issues: ValidationIssue[] };

const ACADEMIC_WINDOW = { min: 600, max: 950 } as const;
const GT_WINDOW = { min: 400, max: 800 } as const;
const ACADEMIC_PARAGRAPHS = { min: 5, max: 7 } as const;
const GT_PARAGRAPHS = { min: 4, max: 6 } as const;
const QUESTION_COUNT = { min: 6, max: 10 } as const;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function passageHaystack(value: GeneratedReading): string {
  // Concatenate every paragraph's text + the title into one soft-normalised
  // haystack used for substring checks. Soft-normalise here mirrors the
  // grader's normalise so an answer that the grader would accept is also
  // accepted by the validator.
  const parts: string[] = [];
  if (value.passage.title) parts.push(value.passage.title);
  for (const p of value.passage.paragraphs) parts.push(p.text);
  return softNormalize(parts.join("\n"));
}

function passageWordCount(value: GeneratedReading): number {
  let n = 0;
  for (const p of value.passage.paragraphs) n += wordCount(p.text);
  return n;
}

function inHaystack(haystack: string, needle: string): boolean {
  const n = softNormalize(needle);
  if (n.length === 0) return false;
  return haystack.includes(n);
}

function expectedParagraphLabel(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

function validatePassageContract(
  value: GeneratedReading,
  issues: ValidationIssue[],
): void {
  if (value.track === "GeneralTraining" && !value.passage.gt_context) {
    issues.push({
      code: "passage.missing-gt-context",
      message: "General Training passages must include passage.gt_context.",
    });
  }

  const range =
    value.track === "Academic" ? ACADEMIC_PARAGRAPHS : GT_PARAGRAPHS;
  const count = value.passage.paragraphs.length;
  if (count < range.min) {
    issues.push({
      code: "passage.too-few-paragraphs",
      message: `${value.track} passages need ${range.min}-${range.max} paragraphs; found ${count}.`,
    });
  } else if (count > range.max) {
    issues.push({
      code: "passage.too-many-paragraphs",
      message: `${value.track} passages need ${range.min}-${range.max} paragraphs; found ${count}.`,
    });
  }

  for (let i = 0; i < value.passage.paragraphs.length; i++) {
    const paragraph = value.passage.paragraphs[i]!;
    const expected = expectedParagraphLabel(i);
    if (paragraph.label !== expected) {
      issues.push({
        code: "passage.invalid-paragraph-labels",
        message: `Paragraph ${i + 1} should be labelled "${expected}" but found "${paragraph.label}".`,
      });
      return;
    }
  }
}

function validateQuestionContract(
  value: GeneratedReading,
  issues: ValidationIssue[],
): void {
  const count = value.questions.length;
  if (count < QUESTION_COUNT.min) {
    issues.push({
      code: "questions.too-few",
      message: `Reading generations need ${QUESTION_COUNT.min}-${QUESTION_COUNT.max} questions; found ${count}.`,
    });
  } else if (count > QUESTION_COUNT.max) {
    issues.push({
      code: "questions.too-many",
      message: `Reading generations need ${QUESTION_COUNT.min}-${QUESTION_COUNT.max} questions; found ${count}.`,
    });
  }

  const positions = value.questions
    .map((q) => q.position)
    .sort((a, b) => a - b);
  for (let i = 0; i < positions.length; i++) {
    if (positions[i] !== i) {
      issues.push({
        code: "questions.non-contiguous-positions",
        message: `Question positions must be 0-indexed and contiguous; found [${positions.join(", ")}].`,
      });
      return;
    }
  }
}

function validateCompletionOrShortAnswer(
  q: GeneratedReadingQuestion,
  idx: number,
  haystack: string,
  issues: ValidationIssue[],
): void {
  if (q.type === "reading-sentence-completion") {
    for (const accepted of q.correct_answer.accepted) {
      if (!inHaystack(haystack, accepted)) {
        issues.push({
          code: "completion.answer-not-in-passage",
          message: `Sentence-completion answer "${accepted}" was not found in the passage (position ${q.position}).`,
          questionIndex: idx,
        });
        // One issue per question is enough — break.
        return;
      }
    }
    return;
  }
  if (q.type === "reading-short-answer") {
    for (const accepted of q.correct_answer.accepted) {
      if (!inHaystack(haystack, accepted)) {
        issues.push({
          code: "short-answer.answer-not-in-passage",
          message: `Short-answer accepted string "${accepted}" was not found in the passage (position ${q.position}).`,
          questionIndex: idx,
        });
        return;
      }
    }
  }
}

function validateMcq(
  q: GeneratedReadingQuestion,
  idx: number,
  haystack: string,
  issues: ValidationIssue[],
): void {
  if (q.type !== "reading-mcq") return;
  // MCQ correctness is inference-heavy; we can't reliably verify the
  // correct option is right. We DO require that the correct option's text
  // share at least one substantive token with the passage — a weak signal
  // that the option is grounded in something the passage said. This
  // catches the obvious failure mode: a hallucinated option that the
  // model made up out of thin air.
  const correct = q.correct_answer.options.find(
    (o) => o.id === q.correct_answer.correct,
  );
  if (!correct) return;
  const tokens = softNormalize(correct.text)
    .split(" ")
    .filter((t) => t.length >= 4); // ignore tiny tokens
  // Need at least one substantive token to be present in the passage.
  // If the correct option is a number/date, accept that too.
  const numbers = correct.text.match(/\d+/g) ?? [];
  for (const n of numbers) if (haystack.includes(n)) return;
  for (const t of tokens) if (haystack.includes(t)) return;
  issues.push({
    code: "mcq.correct-not-grounded",
    message: `MCQ correct option "${correct.text}" shares no substantive tokens with the passage (position ${q.position}).`,
    questionIndex: idx,
  });
}

export function validateGeneratedReading(
  value: GeneratedReading,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  validatePassageContract(value, issues);
  validateQuestionContract(value, issues);

  const wc = passageWordCount(value);
  const win = value.track === "Academic" ? ACADEMIC_WINDOW : GT_WINDOW;
  if (wc < win.min) {
    issues.push({
      code: "passage.too-short",
      message: `Passage has ${wc} words; ${value.track} minimum is ${win.min}.`,
    });
  } else if (wc > win.max) {
    issues.push({
      code: "passage.too-long",
      message: `Passage has ${wc} words; ${value.track} maximum is ${win.max}.`,
    });
  }

  const haystack = passageHaystack(value);
  for (let i = 0; i < value.questions.length; i++) {
    const q = value.questions[i]!;
    validateCompletionOrShortAnswer(q, i, haystack, issues);
    validateMcq(q, i, haystack, issues);
  }

  if (issues.length === 0) return { ok: true };
  return { ok: false, issues };
}
