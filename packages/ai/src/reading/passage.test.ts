// Tiny tests for passage-shape helpers. The full parseReadingPassage
// coverage is implicit via the seed + integration tests; this file is
// for the label-visibility rule which the renderers depend on.

import { describe, expect, it } from "vitest";
import {
  parseReadingPassage,
  passageNeedsParagraphLabels,
  readingPart,
} from "./passage";

describe("passageNeedsParagraphLabels", () => {
  it("returns true when a test contains matching-headings", () => {
    expect(
      passageNeedsParagraphLabels([
        "reading-mcq",
        "reading-matching-headings",
        "reading-sentence-completion",
      ]),
    ).toBe(true);
  });

  it("returns true when a test contains matching-information", () => {
    expect(
      passageNeedsParagraphLabels(["reading-matching-information"]),
    ).toBe(true);
  });

  it("returns false for the Phase-5 generated mix (MCQ + TFNG + SC + short-answer)", () => {
    expect(
      passageNeedsParagraphLabels([
        "reading-mcq",
        "reading-true-false-not-given",
        "reading-yes-no-not-given",
        "reading-sentence-completion",
        "reading-short-answer",
      ]),
    ).toBe(false);
  });

  it("returns false for matching-features / matching-sentence-endings — those reference banks, not paragraphs", () => {
    expect(
      passageNeedsParagraphLabels([
        "reading-matching-features",
        "reading-matching-sentence-endings",
      ]),
    ).toBe(false);
  });

  it("returns false for completion-blank — blanks live inside their own block, not paragraphs", () => {
    expect(
      passageNeedsParagraphLabels(["reading-completion-blank"]),
    ).toBe(false);
  });

  it("returns false for an empty test", () => {
    expect(passageNeedsParagraphLabels([])).toBe(false);
  });

  it("ignores unknown question types", () => {
    expect(
      passageNeedsParagraphLabels([
        "reading-mcq",
        "totally-made-up",
        "reading-true-false-not-given",
      ]),
    ).toBe(false);
  });
});

describe("readingPart", () => {
  it("uses the stamped Academic part", () => {
    expect(readingPart({ part: 2 })).toBe(2);
  });

  it("derives the GT part from gt_context", () => {
    expect(readingPart({ gt_context: "social-survival" })).toBe(1);
    expect(readingPart({ gt_context: "workplace" })).toBe(2);
    expect(readingPart({ gt_context: "general-reading" })).toBe(3);
  });

  it("prefers gt_context over a stray stamped part (GT is canonical)", () => {
    expect(readingPart({ gt_context: "workplace", part: 1 })).toBe(2);
  });

  it("returns null when unlabelled", () => {
    expect(readingPart({})).toBeNull();
  });
});

describe("parseReadingPassage — part", () => {
  const base = {
    paragraphs: [{ label: "A", text: "Some passage text." }],
  };

  it("round-trips a valid part", () => {
    expect(parseReadingPassage({ ...base, part: 3 })?.part).toBe(3);
  });

  it("drops an out-of-range part", () => {
    expect(parseReadingPassage({ ...base, part: 4 })?.part).toBeUndefined();
    expect(parseReadingPassage({ ...base, part: "2" })?.part).toBeUndefined();
  });

  it("leaves part undefined when absent", () => {
    expect(parseReadingPassage(base)?.part).toBeUndefined();
  });
});
