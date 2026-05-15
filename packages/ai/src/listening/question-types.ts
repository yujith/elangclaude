// Listening question-type schemas — Phase 1 set: MCQ (single + multi),
// sentence completion, short answer, completion blank. Parsers are hand-
// written (matching the Reading pattern in question-types.ts) to keep Zod
// out of consumers and to return a discriminated payload (or null) that the
// runner can refuse to render on a single line of code.
//
// The `type` literals here are the canonical strings written to
// `Question.type` in the database. Don't rename — they will be referenced
// from generation output schemas and SuperAdmin moderation surfaces.

export type ListeningQuestionKind =
  | "listening-mcq-single"
  | "listening-mcq-multi"
  | "listening-sentence-completion"
  | "listening-short-answer"
  | "listening-completion-blank";

export const LISTENING_QUESTION_KINDS: ReadonlySet<string> =
  new Set<ListeningQuestionKind>([
    "listening-mcq-single",
    "listening-mcq-multi",
    "listening-sentence-completion",
    "listening-short-answer",
    "listening-completion-blank",
  ]);

export function isListeningQuestionKind(s: string): s is ListeningQuestionKind {
  return LISTENING_QUESTION_KINDS.has(s);
}

// ─── Per-type payload shapes ────────────────────────────────────────────

export type ListeningMcqOption = { id: string; text: string };

export type ListeningMcqSinglePayload = {
  kind: "listening-mcq-single";
  options: ListeningMcqOption[];
  // Stable option id, e.g. "A".
  correct: string;
};

export type ListeningMcqMultiPayload = {
  kind: "listening-mcq-multi";
  options: ListeningMcqOption[];
  // The learner is told "Choose N answers" — pick_count IS that N. Always
  // equals correct.length and is duplicated explicitly so the renderer can
  // display "Choose TWO answers" without inferring it from the payload.
  pick_count: number;
  // Set of option ids — order is not significant, but stored as an array
  // because JSON.
  correct: string[];
};

export type ListeningSentenceCompletionPayload = {
  kind: "listening-sentence-completion";
  // Whole-sentence stem with a literal `___` (3 underscores) marking the
  // blank. The renderer splits on it. Multiple blanks are not supported in
  // Phase 1.
  stem: string;
  // Inclusive maximum word count for the learner's answer.
  word_limit: number;
  // One or more accepted strings. Matching uses the same normalisation rules
  // as Reading (see prompts/grading/reading-normalization.md). Phase 4 lifts
  // those rules into a Listening-specific doc if any divergence appears.
  accepted: string[];
};

export type ListeningShortAnswerPayload = {
  kind: "listening-short-answer";
  word_limit: number;
  accepted: string[];
};

// References one slot inside one completion block on the part's
// completion_blocks. Grading is word-limit + accepted-keys, identical to
// sentence-completion.
export type ListeningCompletionBlankPayload = {
  kind: "listening-completion-blank";
  block_id: string;
  slot_id: string;
  word_limit: number;
  accepted: string[];
};

export type ListeningQuestionPayload =
  | ListeningMcqSinglePayload
  | ListeningMcqMultiPayload
  | ListeningSentenceCompletionPayload
  | ListeningShortAnswerPayload
  | ListeningCompletionBlankPayload;

// ─── Parsers ────────────────────────────────────────────────────────────
//
// These read the `Question.correct_answer` JSON column for a given
// `Question.type` and return a discriminated payload. Returning null on
// any malformed field is intentional — the runner treats a null payload
// as "this question can't be presented" and surfaces a clean error.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((x): x is string => typeof x === "string")) return null;
  return v;
}

function parseOptions(raw: unknown): ListeningMcqOption[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ListeningMcqOption[] = [];
  const seen = new Set<string>();
  for (const o of raw) {
    if (!isObject(o)) return null;
    if (typeof o.id !== "string" || o.id.length === 0) return null;
    if (typeof o.text !== "string" || o.text.length === 0) return null;
    if (seen.has(o.id)) return null;
    seen.add(o.id);
    out.push({ id: o.id, text: o.text });
  }
  if (out.length < 2) return null;
  return out;
}

function parseMcqSingle(raw: unknown): ListeningMcqSinglePayload | null {
  if (!isObject(raw)) return null;
  const options = parseOptions(raw.options);
  if (!options) return null;
  if (typeof raw.correct !== "string") return null;
  if (!options.some((o) => o.id === raw.correct)) return null;
  return { kind: "listening-mcq-single", options, correct: raw.correct };
}

function parseMcqMulti(raw: unknown): ListeningMcqMultiPayload | null {
  if (!isObject(raw)) return null;
  const options = parseOptions(raw.options);
  if (!options) return null;
  const correct = asStringArray(raw.correct);
  if (!correct) return null;
  if (correct.length < 2) return null;
  // No duplicates in correct, each referenced option must exist.
  const correctSet = new Set<string>();
  for (const id of correct) {
    if (correctSet.has(id)) return null;
    if (!options.some((o) => o.id === id)) return null;
    correctSet.add(id);
  }
  // pick_count must be the integer that equals correct.length. This is
  // deliberately strict: a mismatched pick_count is almost always a content
  // bug ("Choose TWO answers" with three correct keys), and silently
  // accepting it would mis-grade the question.
  if (typeof raw.pick_count !== "number") return null;
  if (!Number.isInteger(raw.pick_count)) return null;
  if (raw.pick_count !== correct.length) return null;
  // pick_count must be strictly less than the number of options — otherwise
  // there is no distractor and the question is trivial.
  if (raw.pick_count >= options.length) return null;
  return {
    kind: "listening-mcq-multi",
    options,
    pick_count: raw.pick_count,
    correct,
  };
}

function parseSentenceCompletion(
  raw: unknown,
): ListeningSentenceCompletionPayload | null {
  if (!isObject(raw)) return null;
  if (typeof raw.stem !== "string" || raw.stem.length === 0) return null;
  if (!raw.stem.includes("___")) return null;
  if (typeof raw.word_limit !== "number" || !Number.isInteger(raw.word_limit)) {
    return null;
  }
  if (raw.word_limit < 1 || raw.word_limit > 10) return null;
  const accepted = asStringArray(raw.accepted);
  if (!accepted || accepted.length === 0) return null;
  return {
    kind: "listening-sentence-completion",
    stem: raw.stem,
    word_limit: raw.word_limit,
    accepted,
  };
}

function parseShortAnswer(raw: unknown): ListeningShortAnswerPayload | null {
  if (!isObject(raw)) return null;
  if (typeof raw.word_limit !== "number" || !Number.isInteger(raw.word_limit)) {
    return null;
  }
  if (raw.word_limit < 1 || raw.word_limit > 10) return null;
  const accepted = asStringArray(raw.accepted);
  if (!accepted || accepted.length === 0) return null;
  return {
    kind: "listening-short-answer",
    word_limit: raw.word_limit,
    accepted,
  };
}

function parseCompletionBlank(
  raw: unknown,
): ListeningCompletionBlankPayload | null {
  if (!isObject(raw)) return null;
  if (typeof raw.block_id !== "string" || raw.block_id.length === 0) return null;
  if (typeof raw.slot_id !== "string" || raw.slot_id.length === 0) return null;
  if (typeof raw.word_limit !== "number" || !Number.isInteger(raw.word_limit)) {
    return null;
  }
  if (raw.word_limit < 1 || raw.word_limit > 10) return null;
  const accepted = asStringArray(raw.accepted);
  if (!accepted || accepted.length === 0) return null;
  return {
    kind: "listening-completion-blank",
    block_id: raw.block_id,
    slot_id: raw.slot_id,
    word_limit: raw.word_limit,
    accepted,
  };
}

export function parseListeningQuestionPayload(
  type: string,
  raw: unknown,
): ListeningQuestionPayload | null {
  if (!isListeningQuestionKind(type)) return null;
  switch (type) {
    case "listening-mcq-single":
      return parseMcqSingle(raw);
    case "listening-mcq-multi":
      return parseMcqMulti(raw);
    case "listening-sentence-completion":
      return parseSentenceCompletion(raw);
    case "listening-short-answer":
      return parseShortAnswer(raw);
    case "listening-completion-blank":
      return parseCompletionBlank(raw);
  }
}

// ─── Learner-submitted response shape ───────────────────────────────────
//
// The Answer.response JSON column stores the learner's submission. The shape
// is per-question-kind; the runner UI writes it and the grader reads it.

export type ListeningMcqSingleResponse = {
  kind: "listening-mcq-single";
  selected: string | null;
};

export type ListeningMcqMultiResponse = {
  kind: "listening-mcq-multi";
  // Order is not significant; duplicates are not preserved. Empty array =
  // "no answer". The runner is responsible for capping selections to
  // pick_count at the UI layer; the grader treats over-selections as wrong.
  selected: string[];
};

export type ListeningSentenceCompletionResponse = {
  kind: "listening-sentence-completion";
  text: string;
};

export type ListeningShortAnswerResponse = {
  kind: "listening-short-answer";
  text: string;
};

export type ListeningCompletionBlankResponse = {
  kind: "listening-completion-blank";
  text: string;
};

export type ListeningResponse =
  | ListeningMcqSingleResponse
  | ListeningMcqMultiResponse
  | ListeningSentenceCompletionResponse
  | ListeningShortAnswerResponse
  | ListeningCompletionBlankResponse;

const SINGLE_SELECT_KINDS: ReadonlySet<string> = new Set<ListeningQuestionKind>([
  "listening-mcq-single",
]);

const MULTI_SELECT_KINDS: ReadonlySet<string> = new Set<ListeningQuestionKind>([
  "listening-mcq-multi",
]);

const TEXT_KINDS: ReadonlySet<string> = new Set<ListeningQuestionKind>([
  "listening-sentence-completion",
  "listening-short-answer",
  "listening-completion-blank",
]);

export function parseListeningResponse(
  type: string,
  raw: unknown,
): ListeningResponse | null {
  if (!isListeningQuestionKind(type)) return null;
  if (!isObject(raw)) return null;
  if (TEXT_KINDS.has(type)) {
    const text = typeof raw.text === "string" ? raw.text : "";
    return { kind: type, text } as ListeningResponse;
  }
  if (SINGLE_SELECT_KINDS.has(type)) {
    const selected =
      typeof raw.selected === "string"
        ? raw.selected
        : raw.selected === null
          ? null
          : undefined;
    if (selected === undefined) return null;
    return { kind: type, selected } as ListeningResponse;
  }
  if (MULTI_SELECT_KINDS.has(type)) {
    const selected = asStringArray(raw.selected);
    if (!selected) return null;
    return { kind: "listening-mcq-multi", selected };
  }
  return null;
}
