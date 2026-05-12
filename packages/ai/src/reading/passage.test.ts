// Tiny tests for passage-shape helpers. The full parseReadingPassage
// coverage is implicit via the seed + integration tests; this file is
// for the label-visibility rule which the renderers depend on.

import { describe, expect, it } from "vitest";
import { passageNeedsParagraphLabels } from "./passage";

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
