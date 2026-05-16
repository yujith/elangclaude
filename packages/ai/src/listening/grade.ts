// Listening grader. Deterministic — no AI call. Composes the per-question
// normalisation rules from reading/normalize.ts (Listening reuses every
// rule; see ADR 0007 D6) and the Listening raw→band table in ./band.ts
// into a single grading function the server action calls after submit.
//
// Output is the JSON payload persisted into Grade.criteria_scores_json
// for Listening attempts. The results page reads it back via
// `parseListeningGrade`.
//
// Key shape difference from ReadingGrade: each breakdown item carries
// `points_earned` + `points_possible` so the mcq-multi partial-credit
// case has a clean home. Reading questions are always 0/1, so the
// ReadingBreakdownItem just uses `is_correct`.

import { listeningBandFromPartial, type Track } from "./band";
import { compareMcq, gradeCompletion } from "../reading/normalize";
import {
  parseListeningQuestionPayload,
  parseListeningResponse,
  type ListeningQuestionPayload,
} from "./question-types";

// ─── Inputs ─────────────────────────────────────────────────────────────

export type ListeningGradeQuestion = {
  // Database row id — used as the stable key on the result breakdown.
  id: string;
  // The Question.type literal, e.g. "listening-mcq-single".
  type: string;
  // The Question.correct_answer JSON payload (already-parsed parent JSON).
  correctAnswerJson: unknown;
  // Position the learner saw, for stable ordering on the result page.
  position: number;
  // Points configured on the Question row. For mcq-multi this is the
  // pick_count (≥ 2). For everything else it's 1.
  points: number;
  // Optional human prompt — included on the breakdown so a learner can
  // see what the question asked without re-fetching.
  prompt?: string;
};

export type ListeningGradeAnswer = {
  questionId: string;
  // The Answer.response JSON the learner submitted.
  responseJson: unknown;
};

export type ListeningGradeInput = {
  track: Track;
  questions: ListeningGradeQuestion[];
  answers: ListeningGradeAnswer[];
};

// ─── Output ─────────────────────────────────────────────────────────────

export type ListeningBreakdownItem = {
  question_id: string;
  position: number;
  type: string;
  prompt?: string;
  // For mcq-multi: partial credit possible (0..points_possible).
  // For everything else: 0 or points_possible (which equals 1).
  points_earned: number;
  points_possible: number;
  // True iff points_earned === points_possible. Keeps the simple
  // "right/wrong" affordance for the UI even when partial credit applies.
  is_correct: boolean;
  // Free-text reason — surfaced to the learner ("answer exceeded the
  // 3-word limit", "you picked 1 of 2 correct options"). Stable strings
  // so the UI can match-and-render on them if it ever wants to.
  reason: string;
  // The literal raw response we evaluated, for the "your answer was: …"
  // affordance on the results page.
  learner_summary: string;
  // What we expected — surfaced as the correct option(s) / accepted answers.
  correct_summary: string;
};

export type ListeningGrade = {
  schema_version: 1;
  section: "Listening";
  track: Track;
  raw_correct: number; // total points earned
  raw_total: number; // total points possible
  band_overall: number; // band 0-9 half-band
  breakdown: ListeningBreakdownItem[];
};

// ─── Per-payload summarisers ────────────────────────────────────────────

function summariseCorrect(payload: ListeningQuestionPayload): string {
  switch (payload.kind) {
    case "listening-mcq-single": {
      const opt = payload.options.find((o) => o.id === payload.correct);
      return opt ? `${payload.correct} — ${opt.text}` : payload.correct;
    }
    case "listening-mcq-multi": {
      const labels = payload.correct.map((id) => {
        const o = payload.options.find((opt) => opt.id === id);
        return o ? `${id} — ${o.text}` : id;
      });
      return labels.join(" + ");
    }
    case "listening-sentence-completion":
    case "listening-short-answer":
    case "listening-completion-blank":
      return payload.accepted.join(" / ");
  }
}

function summariseLearner(
  payload: ListeningQuestionPayload,
  rawResponseJson: unknown,
): string {
  const parsed = parseListeningResponse(payload.kind, rawResponseJson);
  if (!parsed) return "—";
  switch (parsed.kind) {
    case "listening-mcq-single": {
      if (parsed.selected === null || parsed.selected === "") return "—";
      const opt =
        payload.kind === "listening-mcq-single"
          ? payload.options.find((o) => o.id === parsed.selected)
          : undefined;
      return opt ? `${parsed.selected} — ${opt.text}` : parsed.selected;
    }
    case "listening-mcq-multi": {
      if (parsed.selected.length === 0) return "—";
      // Map ids back to "{id} — {text}" using the payload's option list,
      // so the result page can show what the learner actually picked.
      const labels = parsed.selected.map((id) => {
        const opt =
          payload.kind === "listening-mcq-multi"
            ? payload.options.find((o) => o.id === id)
            : undefined;
        return opt ? `${id} — ${opt.text}` : id;
      });
      return labels.join(" + ");
    }
    case "listening-sentence-completion":
    case "listening-short-answer":
    case "listening-completion-blank":
      return parsed.text.trim().length === 0 ? "—" : parsed.text.trim();
  }
}

// ─── Per-question grader ────────────────────────────────────────────────

type GradedQuestion = {
  pointsEarned: number;
  pointsPossible: number;
  reason: string;
  learnerSummary: string;
  correctSummary: string;
};

function gradeMcqMulti(
  payload: Extract<ListeningQuestionPayload, { kind: "listening-mcq-multi" }>,
  rawResponseJson: unknown,
  pointsPossible: number,
): GradedQuestion {
  const parsed = parseListeningResponse(payload.kind, rawResponseJson);
  const correctSet = new Set(payload.correct);
  if (
    !parsed ||
    parsed.kind !== "listening-mcq-multi" ||
    parsed.selected.length === 0
  ) {
    return {
      pointsEarned: 0,
      pointsPossible,
      reason: "No answer submitted.",
      learnerSummary: summariseLearner(payload, rawResponseJson),
      correctSummary: summariseCorrect(payload),
    };
  }
  // Per-option scoring: 1 point per correct selection, capped at
  // pick_count (= pointsPossible). No deduction for wrong picks; the UI
  // is responsible for stopping the learner from over-selecting, but the
  // grader is defensive and caps anyway.
  let earned = 0;
  const seen = new Set<string>();
  for (const id of parsed.selected) {
    if (seen.has(id)) continue; // dedupe a duplicate selection
    seen.add(id);
    if (correctSet.has(id)) earned += 1;
  }
  const capped = Math.min(earned, pointsPossible);
  const isFull = capped === pointsPossible;
  const reason = isFull
    ? "Correct."
    : capped === 0
      ? "None of the picks matched the correct answers."
      : `You picked ${capped} of ${pointsPossible} correct options.`;
  return {
    pointsEarned: capped,
    pointsPossible,
    reason,
    learnerSummary: summariseLearner(payload, rawResponseJson),
    correctSummary: summariseCorrect(payload),
  };
}

function gradeMcqSingle(
  payload: Extract<ListeningQuestionPayload, { kind: "listening-mcq-single" }>,
  rawResponseJson: unknown,
  pointsPossible: number,
): GradedQuestion {
  const parsed = parseListeningResponse(payload.kind, rawResponseJson);
  const selected =
    parsed && parsed.kind === "listening-mcq-single" ? parsed.selected : null;
  if (!selected) {
    return {
      pointsEarned: 0,
      pointsPossible,
      reason: "No answer submitted.",
      learnerSummary: "—",
      correctSummary: summariseCorrect(payload),
    };
  }
  const ok = compareMcq(selected, payload.correct);
  return {
    pointsEarned: ok ? pointsPossible : 0,
    pointsPossible,
    reason: ok ? "Correct." : "Incorrect option.",
    learnerSummary: summariseLearner(payload, rawResponseJson),
    correctSummary: summariseCorrect(payload),
  };
}

function gradeCompletionLike(
  payload: Extract<
    ListeningQuestionPayload,
    | { kind: "listening-sentence-completion" }
    | { kind: "listening-short-answer" }
    | { kind: "listening-completion-blank" }
  >,
  rawResponseJson: unknown,
  pointsPossible: number,
): GradedQuestion {
  const parsed = parseListeningResponse(payload.kind, rawResponseJson);
  const text =
    parsed && parsed.kind === payload.kind ? parsed.text : "";
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
    pointsEarned: verdict.isCorrect ? pointsPossible : 0,
    pointsPossible,
    reason,
    learnerSummary: summariseLearner(payload, rawResponseJson),
    correctSummary: summariseCorrect(payload),
  };
}

function gradeOne(
  question: ListeningGradeQuestion,
  responseJson: unknown,
): GradedQuestion | null {
  const payload = parseListeningQuestionPayload(
    question.type,
    question.correctAnswerJson,
  );
  if (!payload) return null;
  // For mcq-multi the points_possible is pick_count; for all others it's
  // always 1 regardless of what the Question row says (defensive — a
  // Question.points value other than 1 on a single-correct kind would
  // distort the band-calc).
  const pointsPossible =
    payload.kind === "listening-mcq-multi"
      ? Math.max(1, question.points)
      : 1;

  if (payload.kind === "listening-mcq-single") {
    return gradeMcqSingle(payload, responseJson, pointsPossible);
  }
  if (payload.kind === "listening-mcq-multi") {
    return gradeMcqMulti(payload, responseJson, pointsPossible);
  }
  return gradeCompletionLike(payload, responseJson, pointsPossible);
}

// ─── Entry point ────────────────────────────────────────────────────────

export function gradeListeningAttempt(
  input: ListeningGradeInput,
): ListeningGrade {
  const answerByQ = new Map<string, unknown>();
  for (const a of input.answers) answerByQ.set(a.questionId, a.responseJson);

  const sorted = [...input.questions].sort((a, b) => a.position - b.position);
  const breakdown: ListeningBreakdownItem[] = [];
  let correct = 0;
  let total = 0;
  for (const q of sorted) {
    const responseJson = answerByQ.get(q.id);
    const evaluated = gradeOne(q, responseJson);
    if (!evaluated) {
      // Malformed question payload — count as graded-incorrect so the
      // raw_total still reflects what the learner saw, but surface a
      // distinct reason. The runner SHOULD have refused to render this
      // question; reaching here means a seed/generation bug.
      breakdown.push({
        question_id: q.id,
        position: q.position,
        type: q.type,
        prompt: q.prompt,
        points_earned: 0,
        points_possible: q.points,
        is_correct: false,
        reason: "Question payload is malformed and could not be graded.",
        learner_summary: "—",
        correct_summary: "—",
      });
      total += q.points;
      continue;
    }
    correct += evaluated.pointsEarned;
    total += evaluated.pointsPossible;
    breakdown.push({
      question_id: q.id,
      position: q.position,
      type: q.type,
      prompt: q.prompt,
      points_earned: evaluated.pointsEarned,
      points_possible: evaluated.pointsPossible,
      is_correct: evaluated.pointsEarned === evaluated.pointsPossible,
      reason: evaluated.reason,
      learner_summary: evaluated.learnerSummary,
      correct_summary: evaluated.correctSummary,
    });
  }

  const band = listeningBandFromPartial(input.track, correct, total);
  return {
    schema_version: 1,
    section: "Listening",
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
// The results page calls this to recover a typed `ListeningGrade` and
// falls back to a "grading hit a snag" UI on null.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseListeningGrade(raw: unknown): ListeningGrade | null {
  if (!isObject(raw)) return null;
  if (raw.schema_version !== 1) return null;
  if (raw.section !== "Listening") return null;
  if (raw.track !== "Academic" && raw.track !== "GeneralTraining") return null;
  if (typeof raw.raw_correct !== "number" || typeof raw.raw_total !== "number") {
    return null;
  }
  if (typeof raw.band_overall !== "number") return null;
  if (!Array.isArray(raw.breakdown)) return null;
  const breakdown: ListeningBreakdownItem[] = [];
  for (const b of raw.breakdown) {
    if (!isObject(b)) return null;
    if (typeof b.question_id !== "string") return null;
    if (typeof b.position !== "number") return null;
    if (typeof b.type !== "string") return null;
    if (typeof b.points_earned !== "number") return null;
    if (typeof b.points_possible !== "number") return null;
    if (typeof b.is_correct !== "boolean") return null;
    if (typeof b.reason !== "string") return null;
    if (typeof b.learner_summary !== "string") return null;
    if (typeof b.correct_summary !== "string") return null;
    breakdown.push({
      question_id: b.question_id,
      position: b.position,
      type: b.type,
      prompt: typeof b.prompt === "string" ? b.prompt : undefined,
      points_earned: b.points_earned,
      points_possible: b.points_possible,
      is_correct: b.is_correct,
      reason: b.reason,
      learner_summary: b.learner_summary,
      correct_summary: b.correct_summary,
    });
  }
  return {
    schema_version: 1,
    section: "Listening",
    track: raw.track,
    raw_correct: raw.raw_correct,
    raw_total: raw.raw_total,
    band_overall: raw.band_overall,
    breakdown,
  };
}
