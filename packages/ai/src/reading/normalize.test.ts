// Asserts the normalisation contract at prompts/grading/reading-
// normalization.md. The worked-examples table there maps 1:1 to the
// "Worked examples" describe block below — if a row in the doc changes,
// add a case here in the same PR.

import { describe, expect, it } from "vitest";
import {
  compareBankKey,
  compareMcq,
  compareTfng,
  gradeCompletion,
  normaliseCompletionAnswer,
  softNormalize,
  wordCount,
} from "./normalize";

describe("softNormalize", () => {
  it("collapses whitespace, trims, case-folds, NFKC-normalises", () => {
    expect(softNormalize("  The  Quick   Brown  ")).toBe("the quick brown");
    expect(softNormalize("CAFÉ")).toBe(softNormalize("café"));
    // Full-width digit "５" -> "5" via NFKC.
    expect(softNormalize("ID ５")).toBe("id 5");
  });
});

describe("wordCount", () => {
  it("counts single-space-delimited words; hyphens stay one token", () => {
    expect(wordCount("modern computer")).toBe(2);
    expect(wordCount("sun-light")).toBe(1);
    expect(wordCount("")).toBe(0);
  });
});

describe("compareMcq", () => {
  it("matches case-insensitively on the option id", () => {
    expect(compareMcq("b", "B")).toBe(true);
    expect(compareMcq("B", "B")).toBe(true);
  });
  it("missing answer is incorrect", () => {
    expect(compareMcq(null, "B")).toBe(false);
    expect(compareMcq("", "B")).toBe(false);
  });
});

describe("compareTfng", () => {
  it("accepts long labels case-insensitively", () => {
    expect(compareTfng("Not Given", "not given")).toBe(true);
    expect(compareTfng("TRUE", "true")).toBe(true);
  });
  it("rejects shorthand", () => {
    expect(compareTfng("T", "true")).toBe(false);
    expect(compareTfng("NG", "not given")).toBe(false);
  });
  it("missing answer is incorrect", () => {
    expect(compareTfng(null, "false")).toBe(false);
  });
});

describe("gradeCompletion — worked examples from the spec", () => {
  it("article-stripped match: 'the modern computer' vs ['modern computer']", () => {
    const r = gradeCompletion("the modern computer", ["modern computer"], 2);
    expect(r.isCorrect).toBe(true);
    expect(r.reason).toBe("match");
    expect(r.wordCount).toBe(2);
  });
  it("article-stripped match: 'a modern computer' vs ['modern computer']", () => {
    const r = gradeCompletion("a modern computer", ["modern computer"], 2);
    expect(r.isCorrect).toBe(true);
  });
  it("over-word-limit: 'a very modern computer' (3 words post-strip) vs limit 2", () => {
    const r = gradeCompletion("a very modern computer", ["modern computer"], 2);
    expect(r.isCorrect).toBe(false);
    expect(r.reason).toBe("over-word-limit");
    expect(r.wordCount).toBe(3);
  });
  it("hyphenated tokens count as one word", () => {
    // "Sunlight" is a different token from "sun-light" and must NOT match.
    const r = gradeCompletion("Sunlight", ["sun-light"], 3);
    expect(r.isCorrect).toBe(false);
    expect(r.reason).toBe("no-match");
  });
  it("trailing punctuation is stripped", () => {
    const r = gradeCompletion("sun-light.", ["sun-light"], 3);
    expect(r.isCorrect).toBe(true);
  });
  it("digit and word forms are not equivalent", () => {
    const r = gradeCompletion("3", ["three"], 3);
    expect(r.isCorrect).toBe(false);
    expect(r.reason).toBe("no-match");
  });
  it("empty answer is incorrect with reason 'empty'", () => {
    const r = gradeCompletion("   ", ["modern computer"], 2);
    expect(r.isCorrect).toBe(false);
    expect(r.reason).toBe("empty");
  });
  it("first-match across accepted keys wins", () => {
    const r = gradeCompletion("printing press", ["press", "printing press"], 2);
    expect(r.isCorrect).toBe(true);
  });
});

describe("compareBankKey — matching types", () => {
  it("matches case-insensitively", () => {
    expect(compareBankKey("iii", "iii")).toBe(true);
    expect(compareBankKey("III", "iii")).toBe(true);
    expect(compareBankKey("b", "B")).toBe(true);
  });
  it("missing or empty answer is incorrect", () => {
    expect(compareBankKey(null, "iii")).toBe(false);
    expect(compareBankKey("", "iii")).toBe(false);
  });
  it("wrong key is incorrect", () => {
    expect(compareBankKey("iv", "iii")).toBe(false);
    expect(compareBankKey("C", "B")).toBe(false);
  });
});

describe("normaliseCompletionAnswer", () => {
  it("strips trailing punctuation before article", () => {
    expect(normaliseCompletionAnswer("The dog.")).toBe("dog");
  });
  it("does not eat interior punctuation", () => {
    expect(normaliseCompletionAnswer("co-author")).toBe("co-author");
  });
});
