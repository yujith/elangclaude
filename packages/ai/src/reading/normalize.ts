// Reading answer normalisation.
//
// The canonical contract is prompts/grading/reading-normalization.md. This
// module is the implementation; the tests next door exist precisely so a
// drift between the spec and the code shows up in CI.
//
// Phase 1 covers MCQ, T/F/NG, Y/N/NG, sentence-completion. Adding a new
// question type means extending the spec doc first, then this file.

// ─── Universal "soft-normalise" ─────────────────────────────────────────

export function softNormalize(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");
}

// ─── Sentence-completion helpers ────────────────────────────────────────

const LEADING_ARTICLE = /^(?:a|an|the)\s+/;
const TRAILING_PUNCT = /[.,;:!?]+$/;

function stripLeadingArticle(s: string): string {
  return s.replace(LEADING_ARTICLE, "");
}

function stripTrailingPunct(s: string): string {
  return s.replace(TRAILING_PUNCT, "");
}

export function normaliseCompletionAnswer(raw: string): string {
  // Order matters: soft-normalise → trailing-punct strip → leading-article
  // strip. Trailing punct must go before the article strip otherwise a
  // single-word answer like "The." would become "The" → no article match.
  const soft = softNormalize(raw);
  const punct = stripTrailingPunct(soft);
  return stripLeadingArticle(punct);
}

export function wordCount(s: string): number {
  // s is expected to be soft-normalised + article-stripped before this is
  // called. Single ASCII space delimiter; hyphenated tokens count as one.
  if (s.length === 0) return 0;
  return s.split(" ").filter(Boolean).length;
}

// ─── Per-type comparisons ───────────────────────────────────────────────

export function compareMcq(learnerSelected: string | null, correctId: string): boolean {
  if (typeof learnerSelected !== "string") return false;
  return softNormalize(learnerSelected) === softNormalize(correctId);
}

export function compareTfng(
  learnerSelected: string | null,
  correctLabel: string,
): boolean {
  if (typeof learnerSelected !== "string") return false;
  const got = softNormalize(learnerSelected);
  // Only the long labels are accepted — shorthand ("T", "F", "NG") is
  // graded incorrect per the spec.
  return got === softNormalize(correctLabel);
}

// Used by all matching-* types and by matching-information (where the
// "bank" is the passage's paragraph labels). Soft-normalised equality on
// the bank-item key string.
export function compareBankKey(
  learnerSelected: string | null,
  correctKey: string,
): boolean {
  if (typeof learnerSelected !== "string" || learnerSelected.length === 0) {
    return false;
  }
  return softNormalize(learnerSelected) === softNormalize(correctKey);
}

export type CompletionGrading = {
  isCorrect: boolean;
  // Surfaced so the UI can explain *why* a near-miss was wrong.
  reason: "match" | "over-word-limit" | "no-match" | "empty";
  wordCount: number;
};

export function gradeCompletion(
  learnerRaw: string,
  accepted: string[],
  wordLimit: number,
): CompletionGrading {
  const normalised = normaliseCompletionAnswer(learnerRaw);
  if (normalised.length === 0) {
    return { isCorrect: false, reason: "empty", wordCount: 0 };
  }
  const wc = wordCount(normalised);
  if (wc > wordLimit) {
    return { isCorrect: false, reason: "over-word-limit", wordCount: wc };
  }
  for (const key of accepted) {
    const keyNorm = normaliseCompletionAnswer(key);
    if (keyNorm === normalised) {
      return { isCorrect: true, reason: "match", wordCount: wc };
    }
  }
  return { isCorrect: false, reason: "no-match", wordCount: wc };
}
