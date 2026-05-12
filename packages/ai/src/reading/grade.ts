// Reading grader. Deterministic — no AI call. Composes the per-question
// normalisation rules in ./normalize.ts and the published raw→band table
// in ./band.ts into a single grading function the server action calls
// after submit.
//
// Output is the JSON payload persisted into Grade.criteria_scores_json
// for Reading attempts. The results page reads it back via
// `readingGradeSchemaParse`.

import { bandFromPartial, type Track } from "./band";
import {
  compareBankKey,
  compareMcq,
  compareTfng,
  gradeCompletion,
} from "./normalize";
import type { MatchingGroup } from "./passage";
import {
  parseQuestionPayload,
  parseReadingResponse,
  type ReadingQuestionPayload,
} from "./question-types";

// ─── Inputs ─────────────────────────────────────────────────────────────

export type ReadingGradeQuestion = {
  // Database row id — used as the stable key on the result breakdown.
  id: string;
  // The Question.type literal, e.g. "reading-mcq".
  type: string;
  // The Question.correct_answer JSON payload (already-parsed parent JSON).
  correctAnswerJson: unknown;
  // Position the learner saw, for stable ordering on the result page.
  position: number;
  // Optional human prompt — included on the breakdown so a learner can
  // see what the question actually asked without re-fetching.
  prompt?: string;
};

export type ReadingGradeAnswer = {
  questionId: string;
  // The Answer.response JSON the learner submitted.
  responseJson: unknown;
};

export type ReadingGradeInput = {
  track: Track;
  questions: ReadingGradeQuestion[];
  answers: ReadingGradeAnswer[];
  // Optional. Lets the grader resolve a matching-group bank key into the
  // human text for the breakdown ("iii — The economic case"). Without it,
  // breakdown shows the bare key. Correctness does not depend on it.
  passageContext?: {
    paragraphLabels?: string[];
    matchingGroups?: MatchingGroup[];
  };
};

// ─── Output ─────────────────────────────────────────────────────────────

export type ReadingBreakdownItem = {
  question_id: string;
  position: number;
  type: string;
  prompt?: string;
  is_correct: boolean;
  // Free-text reason — surfaced to the learner ("answer exceeded the 3-word
  // limit", "no answer submitted", "incorrect option"). Stable strings so
  // the UI can match-and-render on them if it ever wants to.
  reason: string;
  // The literal raw response we evaluated, for the "your answer was: …"
  // affordance on the results page.
  learner_summary: string;
  // What we expected — surfaced as the correct option / label / accepted
  // answers list.
  correct_summary: string;
};

export type ReadingGrade = {
  schema_version: 1;
  section: "Reading";
  track: Track;
  raw_correct: number;
  raw_total: number;
  // Band 0–9 in half-band increments. Approximate because a single-passage
  // practice unit isn't a full 40-question section — see band.ts.
  band_overall: number;
  breakdown: ReadingBreakdownItem[];
};

// ─── Grader ─────────────────────────────────────────────────────────────

function bankItemText(
  groups: MatchingGroup[] | undefined,
  groupId: string,
  key: string,
): string | undefined {
  if (!groups) return undefined;
  const g = groups.find((x) => x.id === groupId);
  if (!g) return undefined;
  return g.items.find((it) => it.key === key)?.text;
}

function summariseCorrect(
  payload: ReadingQuestionPayload,
  ctx?: ReadingGradeInput["passageContext"],
): string {
  switch (payload.kind) {
    case "reading-mcq": {
      const opt = payload.options.find((o) => o.id === payload.correct);
      return opt ? `${payload.correct} — ${opt.text}` : payload.correct;
    }
    case "reading-true-false-not-given":
    case "reading-yes-no-not-given":
      return payload.correct.toUpperCase();
    case "reading-sentence-completion":
    case "reading-short-answer":
    case "reading-completion-blank":
      return payload.accepted.join(" / ");
    case "reading-matching-headings":
    case "reading-matching-features":
    case "reading-matching-sentence-endings": {
      const text = bankItemText(
        ctx?.matchingGroups,
        payload.group_id,
        payload.correct,
      );
      return text ? `${payload.correct} — ${text}` : payload.correct;
    }
    case "reading-matching-information":
      return `Paragraph ${payload.correct}`;
  }
}

function summariseLearner(
  payload: ReadingQuestionPayload,
  rawResponseJson: unknown,
  ctx?: ReadingGradeInput["passageContext"],
): string {
  const parsed = parseReadingResponse(payload.kind, rawResponseJson);
  if (!parsed) return "—";
  switch (parsed.kind) {
    case "reading-mcq": {
      if (parsed.selected === null || parsed.selected === "") return "—";
      const opt =
        payload.kind === "reading-mcq"
          ? payload.options.find((o) => o.id === parsed.selected)
          : undefined;
      return opt ? `${parsed.selected} — ${opt.text}` : parsed.selected;
    }
    case "reading-true-false-not-given":
    case "reading-yes-no-not-given":
      return parsed.selected ? parsed.selected.toUpperCase() : "—";
    case "reading-sentence-completion":
    case "reading-short-answer":
    case "reading-completion-blank":
      return parsed.text.trim().length === 0 ? "—" : parsed.text.trim();
    case "reading-matching-headings":
    case "reading-matching-features":
    case "reading-matching-sentence-endings": {
      if (!parsed.selected) return "—";
      if (
        payload.kind === "reading-matching-headings" ||
        payload.kind === "reading-matching-features" ||
        payload.kind === "reading-matching-sentence-endings"
      ) {
        const text = bankItemText(
          ctx?.matchingGroups,
          payload.group_id,
          parsed.selected,
        );
        return text ? `${parsed.selected} — ${text}` : parsed.selected;
      }
      return parsed.selected;
    }
    case "reading-matching-information":
      return parsed.selected ? `Paragraph ${parsed.selected}` : "—";
  }
}

function gradeOne(
  question: ReadingGradeQuestion,
  responseJson: unknown,
  ctx?: ReadingGradeInput["passageContext"],
): { isCorrect: boolean; reason: string; learnerSummary: string; correctSummary: string } | null {
  const payload = parseQuestionPayload(question.type, question.correctAnswerJson);
  if (!payload) return null;
  const correctSummary = summariseCorrect(payload, ctx);
  const learnerSummary = summariseLearner(payload, responseJson, ctx);
  const learner = parseReadingResponse(payload.kind, responseJson);

  switch (payload.kind) {
    case "reading-mcq": {
      const selected = learner && learner.kind === "reading-mcq" ? learner.selected : null;
      if (!selected) {
        return {
          isCorrect: false,
          reason: "No answer submitted.",
          learnerSummary,
          correctSummary,
        };
      }
      const ok = compareMcq(selected, payload.correct);
      return {
        isCorrect: ok,
        reason: ok ? "Correct." : "Incorrect option.",
        learnerSummary,
        correctSummary,
      };
    }
    case "reading-true-false-not-given":
    case "reading-yes-no-not-given": {
      const selected =
        learner && learner.kind === payload.kind ? learner.selected : null;
      if (!selected) {
        return {
          isCorrect: false,
          reason: "No answer submitted.",
          learnerSummary,
          correctSummary,
        };
      }
      const ok = compareTfng(selected, payload.correct);
      return {
        isCorrect: ok,
        reason: ok ? "Correct." : "Incorrect label.",
        learnerSummary,
        correctSummary,
      };
    }
    case "reading-sentence-completion":
    case "reading-short-answer":
    case "reading-completion-blank": {
      const text =
        learner && learner.kind === payload.kind ? learner.text : "";
      const verdict = gradeCompletion(text, payload.accepted, payload.word_limit);
      let reason = "Correct.";
      if (!verdict.isCorrect) {
        switch (verdict.reason) {
          case "empty":
            reason = "No answer submitted.";
            break;
          case "over-word-limit":
            reason = `Over the ${payload.word_limit}-word limit (${verdict.wordCount} words).`;
            break;
          case "no-match":
            reason = "Doesn't match the accepted answer.";
            break;
          case "match":
            reason = "Correct.";
            break;
        }
      }
      return {
        isCorrect: verdict.isCorrect,
        reason,
        learnerSummary,
        correctSummary,
      };
    }
    case "reading-matching-headings":
    case "reading-matching-features":
    case "reading-matching-sentence-endings":
    case "reading-matching-information": {
      const selected =
        learner && learner.kind === payload.kind ? learner.selected : null;
      if (!selected) {
        return {
          isCorrect: false,
          reason: "No answer submitted.",
          learnerSummary,
          correctSummary,
        };
      }
      const ok = compareBankKey(selected, payload.correct);
      return {
        isCorrect: ok,
        reason: ok ? "Correct." : "Incorrect match.",
        learnerSummary,
        correctSummary,
      };
    }
  }
}

export function gradeReadingAttempt(input: ReadingGradeInput): ReadingGrade {
  const answerByQ = new Map<string, unknown>();
  for (const a of input.answers) answerByQ.set(a.questionId, a.responseJson);

  const sorted = [...input.questions].sort((a, b) => a.position - b.position);
  const breakdown: ReadingBreakdownItem[] = [];
  let correct = 0;
  let total = 0;
  for (const q of sorted) {
    const responseJson = answerByQ.get(q.id);
    const evaluated = gradeOne(q, responseJson, input.passageContext);
    if (!evaluated) {
      // Malformed question payload — count it as graded-incorrect so the
      // raw_total still reflects what the learner saw, but surface a
      // distinct reason. The runner SHOULD have refused to render this
      // question; reaching here means a seed/generation bug.
      breakdown.push({
        question_id: q.id,
        position: q.position,
        type: q.type,
        prompt: q.prompt,
        is_correct: false,
        reason: "Question payload is malformed and could not be graded.",
        learner_summary: "—",
        correct_summary: "—",
      });
      total += 1;
      continue;
    }
    if (evaluated.isCorrect) correct += 1;
    total += 1;
    breakdown.push({
      question_id: q.id,
      position: q.position,
      type: q.type,
      prompt: q.prompt,
      is_correct: evaluated.isCorrect,
      reason: evaluated.reason,
      learner_summary: evaluated.learnerSummary,
      correct_summary: evaluated.correctSummary,
    });
  }

  const band = bandFromPartial(input.track, correct, total);
  return {
    schema_version: 1,
    section: "Reading",
    track: input.track,
    raw_correct: correct,
    raw_total: total,
    band_overall: band,
    breakdown,
  };
}

// ─── Read-back parser ───────────────────────────────────────────────────
//
// The Grade.criteria_scores_json column is `unknown` at the type level.
// The results page calls this to recover a typed `ReadingGrade` and falls
// back to a "grading hit a snag" UI on null.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseReadingGrade(raw: unknown): ReadingGrade | null {
  if (!isObject(raw)) return null;
  if (raw.schema_version !== 1) return null;
  if (raw.section !== "Reading") return null;
  if (raw.track !== "Academic" && raw.track !== "GeneralTraining") return null;
  if (typeof raw.raw_correct !== "number" || typeof raw.raw_total !== "number") return null;
  if (typeof raw.band_overall !== "number") return null;
  if (!Array.isArray(raw.breakdown)) return null;
  const breakdown: ReadingBreakdownItem[] = [];
  for (const b of raw.breakdown) {
    if (!isObject(b)) return null;
    if (typeof b.question_id !== "string") return null;
    if (typeof b.position !== "number") return null;
    if (typeof b.type !== "string") return null;
    if (typeof b.is_correct !== "boolean") return null;
    if (typeof b.reason !== "string") return null;
    if (typeof b.learner_summary !== "string") return null;
    if (typeof b.correct_summary !== "string") return null;
    breakdown.push({
      question_id: b.question_id,
      position: b.position,
      type: b.type,
      prompt: typeof b.prompt === "string" ? b.prompt : undefined,
      is_correct: b.is_correct,
      reason: b.reason,
      learner_summary: b.learner_summary,
      correct_summary: b.correct_summary,
    });
  }
  return {
    schema_version: 1,
    section: "Reading",
    track: raw.track,
    raw_correct: raw.raw_correct,
    raw_total: raw.raw_total,
    band_overall: raw.band_overall,
    breakdown,
  };
}
