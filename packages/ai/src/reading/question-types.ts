// Reading question-type schemas — Phase 1 set: MCQ, T/F/NG, Y/N/NG, sentence
// completion. Parsers are hand-written (matching the visual.ts pattern) to
// avoid pulling Zod into apps/web. Each parser returns a discriminated union
// or null; the runner refuses to render a question whose payload is invalid.
//
// The `type` literals here are the canonical strings written to
// `Question.type` in the database. Don't rename — they're referenced from
// seed data and (later) from the generation output schema.

export type ReadingQuestionKind =
  | "reading-mcq"
  | "reading-true-false-not-given"
  | "reading-yes-no-not-given"
  | "reading-sentence-completion"
  | "reading-matching-headings"
  | "reading-matching-information"
  | "reading-matching-features"
  | "reading-matching-sentence-endings"
  | "reading-short-answer"
  | "reading-completion-blank";

export const READING_QUESTION_KINDS: ReadonlySet<string> = new Set<ReadingQuestionKind>([
  "reading-mcq",
  "reading-true-false-not-given",
  "reading-yes-no-not-given",
  "reading-sentence-completion",
  "reading-matching-headings",
  "reading-matching-information",
  "reading-matching-features",
  "reading-matching-sentence-endings",
  "reading-short-answer",
  "reading-completion-blank",
]);

export function isReadingQuestionKind(s: string): s is ReadingQuestionKind {
  return READING_QUESTION_KINDS.has(s);
}

// ─── Per-type payload shapes ────────────────────────────────────────────

export type McqOption = { id: string; text: string };

export type McqPayload = {
  kind: "reading-mcq";
  options: McqOption[];
  // Stable option id, e.g. "A".
  correct: string;
};

export type TfngLabel = "true" | "false" | "not given";
export type YnngLabel = "yes" | "no" | "not given";

export type TfngPayload = {
  kind: "reading-true-false-not-given";
  correct: TfngLabel;
};

export type YnngPayload = {
  kind: "reading-yes-no-not-given";
  correct: YnngLabel;
};

export type SentenceCompletionPayload = {
  kind: "reading-sentence-completion";
  // Whole-sentence stem with a literal `___` (3 underscores) marking the
  // blank. The renderer splits on it. Multiple blanks are not supported
  // in Phase 1.
  stem: string;
  // Inclusive maximum word count for the learner's answer.
  word_limit: number;
  // One or more accepted strings. Matching uses the normalisation rules at
  // prompts/grading/reading-normalization.md.
  accepted: string[];
};

// All matching-* kinds share the same "pick one key from a bank" shape on
// the storage side. The bank itself lives on the passage payload (or, for
// matching-information, is the passage's paragraph labels — no separate
// group needed).

export type MatchingHeadingsPayload = {
  kind: "reading-matching-headings";
  // References a matching_groups entry on the passage by id.
  group_id: string;
  correct: string;
};

export type MatchingInformationPayload = {
  kind: "reading-matching-information";
  // Paragraph label, e.g. "A".
  correct: string;
};

export type MatchingFeaturesPayload = {
  kind: "reading-matching-features";
  group_id: string;
  correct: string;
};

export type MatchingSentenceEndingsPayload = {
  kind: "reading-matching-sentence-endings";
  group_id: string;
  correct: string;
};

// Same answer mechanics as sentence-completion (word_limit + accepted
// strings) but no embedded `___` blank — the prompt IS the question.
export type ShortAnswerPayload = {
  kind: "reading-short-answer";
  word_limit: number;
  accepted: string[];
};

// References one slot inside one completion block on the passage's
// body_json.completion_blocks. Grading is word-limit + accepted-keys,
// identical to sentence-completion.
export type CompletionBlankPayload = {
  kind: "reading-completion-blank";
  block_id: string;
  slot_id: string;
  word_limit: number;
  accepted: string[];
};

export type ReadingQuestionPayload =
  | McqPayload
  | TfngPayload
  | YnngPayload
  | SentenceCompletionPayload
  | MatchingHeadingsPayload
  | MatchingInformationPayload
  | MatchingFeaturesPayload
  | MatchingSentenceEndingsPayload
  | ShortAnswerPayload
  | CompletionBlankPayload;

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

function parseMcq(raw: unknown): McqPayload | null {
  if (!isObject(raw)) return null;
  if (!Array.isArray(raw.options)) return null;
  const options: McqOption[] = [];
  const seenIds = new Set<string>();
  for (const o of raw.options) {
    if (!isObject(o)) return null;
    if (typeof o.id !== "string" || o.id.length === 0) return null;
    if (typeof o.text !== "string" || o.text.length === 0) return null;
    if (seenIds.has(o.id)) return null;
    seenIds.add(o.id);
    options.push({ id: o.id, text: o.text });
  }
  if (options.length < 2) return null;
  if (typeof raw.correct !== "string") return null;
  if (!seenIds.has(raw.correct)) return null;
  return { kind: "reading-mcq", options, correct: raw.correct };
}

const TFNG_LABELS: ReadonlySet<TfngLabel> = new Set(["true", "false", "not given"]);
const YNNG_LABELS: ReadonlySet<YnngLabel> = new Set(["yes", "no", "not given"]);

function parseTfng(raw: unknown): TfngPayload | null {
  if (!isObject(raw)) return null;
  if (typeof raw.correct !== "string") return null;
  const c = raw.correct.toLowerCase();
  if (!TFNG_LABELS.has(c as TfngLabel)) return null;
  return { kind: "reading-true-false-not-given", correct: c as TfngLabel };
}

function parseYnng(raw: unknown): YnngPayload | null {
  if (!isObject(raw)) return null;
  if (typeof raw.correct !== "string") return null;
  const c = raw.correct.toLowerCase();
  if (!YNNG_LABELS.has(c as YnngLabel)) return null;
  return { kind: "reading-yes-no-not-given", correct: c as YnngLabel };
}

function parseSentenceCompletion(raw: unknown): SentenceCompletionPayload | null {
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
    kind: "reading-sentence-completion",
    stem: raw.stem,
    word_limit: raw.word_limit,
    accepted,
  };
}

function parseGroupedMatching(
  kind:
    | "reading-matching-headings"
    | "reading-matching-features"
    | "reading-matching-sentence-endings",
  raw: unknown,
):
  | MatchingHeadingsPayload
  | MatchingFeaturesPayload
  | MatchingSentenceEndingsPayload
  | null {
  if (!isObject(raw)) return null;
  if (typeof raw.group_id !== "string" || raw.group_id.length === 0) return null;
  if (typeof raw.correct !== "string" || raw.correct.length === 0) return null;
  return { kind, group_id: raw.group_id, correct: raw.correct } as
    | MatchingHeadingsPayload
    | MatchingFeaturesPayload
    | MatchingSentenceEndingsPayload;
}

function parseMatchingInformation(
  raw: unknown,
): MatchingInformationPayload | null {
  if (!isObject(raw)) return null;
  if (typeof raw.correct !== "string" || raw.correct.length === 0) return null;
  return { kind: "reading-matching-information", correct: raw.correct };
}

function parseShortAnswer(raw: unknown): ShortAnswerPayload | null {
  if (!isObject(raw)) return null;
  if (typeof raw.word_limit !== "number" || !Number.isInteger(raw.word_limit)) {
    return null;
  }
  if (raw.word_limit < 1 || raw.word_limit > 10) return null;
  const accepted = asStringArray(raw.accepted);
  if (!accepted || accepted.length === 0) return null;
  return {
    kind: "reading-short-answer",
    word_limit: raw.word_limit,
    accepted,
  };
}

function parseCompletionBlank(raw: unknown): CompletionBlankPayload | null {
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
    kind: "reading-completion-blank",
    block_id: raw.block_id,
    slot_id: raw.slot_id,
    word_limit: raw.word_limit,
    accepted,
  };
}

export function parseQuestionPayload(
  type: string,
  raw: unknown,
): ReadingQuestionPayload | null {
  if (!isReadingQuestionKind(type)) return null;
  switch (type) {
    case "reading-mcq":
      return parseMcq(raw);
    case "reading-true-false-not-given":
      return parseTfng(raw);
    case "reading-yes-no-not-given":
      return parseYnng(raw);
    case "reading-sentence-completion":
      return parseSentenceCompletion(raw);
    case "reading-matching-headings":
    case "reading-matching-features":
    case "reading-matching-sentence-endings":
      return parseGroupedMatching(type, raw);
    case "reading-matching-information":
      return parseMatchingInformation(raw);
    case "reading-short-answer":
      return parseShortAnswer(raw);
    case "reading-completion-blank":
      return parseCompletionBlank(raw);
  }
}

// ─── Learner-submitted response shape ───────────────────────────────────
//
// The Answer.response JSON column stores the learner's submission. Shape
// is per-question-kind; the runner UI writes it and the grader reads it.

export type McqResponse = { kind: "reading-mcq"; selected: string | null };
export type TfngResponse = { kind: "reading-true-false-not-given"; selected: string | null };
export type YnngResponse = { kind: "reading-yes-no-not-given"; selected: string | null };
export type SentenceCompletionResponse = {
  kind: "reading-sentence-completion";
  text: string;
};
export type MatchingHeadingsResponse = {
  kind: "reading-matching-headings";
  selected: string | null;
};
export type MatchingInformationResponse = {
  kind: "reading-matching-information";
  selected: string | null;
};
export type MatchingFeaturesResponse = {
  kind: "reading-matching-features";
  selected: string | null;
};
export type MatchingSentenceEndingsResponse = {
  kind: "reading-matching-sentence-endings";
  selected: string | null;
};
export type ShortAnswerResponse = {
  kind: "reading-short-answer";
  text: string;
};
export type CompletionBlankResponse = {
  kind: "reading-completion-blank";
  text: string;
};

export type ReadingResponse =
  | McqResponse
  | TfngResponse
  | YnngResponse
  | SentenceCompletionResponse
  | MatchingHeadingsResponse
  | MatchingInformationResponse
  | MatchingFeaturesResponse
  | MatchingSentenceEndingsResponse
  | ShortAnswerResponse
  | CompletionBlankResponse;

const SELECTED_KINDS: ReadonlySet<string> = new Set<ReadingQuestionKind>([
  "reading-mcq",
  "reading-true-false-not-given",
  "reading-yes-no-not-given",
  "reading-matching-headings",
  "reading-matching-information",
  "reading-matching-features",
  "reading-matching-sentence-endings",
]);

const TEXT_KINDS: ReadonlySet<string> = new Set<ReadingQuestionKind>([
  "reading-sentence-completion",
  "reading-short-answer",
  "reading-completion-blank",
]);

export function parseReadingResponse(
  type: string,
  raw: unknown,
): ReadingResponse | null {
  if (!isReadingQuestionKind(type)) return null;
  if (!isObject(raw)) return null;
  if (TEXT_KINDS.has(type)) {
    const text = typeof raw.text === "string" ? raw.text : "";
    return { kind: type, text } as ReadingResponse;
  }
  if (SELECTED_KINDS.has(type)) {
    const selected =
      typeof raw.selected === "string"
        ? raw.selected
        : raw.selected === null
          ? null
          : undefined;
    if (selected === undefined) return null;
    return { kind: type, selected } as ReadingResponse;
  }
  return null;
}
