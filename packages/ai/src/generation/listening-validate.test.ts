import { describe, expect, it } from "vitest";
import type { GeneratedListening } from "./listening-schema";
import { validateGeneratedListening } from "./listening-validate";
import { validatorCleanGeneration as validatorFixture } from "./listening-test-fixtures";

describe("validateGeneratedListening — happy path", () => {
  it("returns ok on a fully grounded fixture", () => {
    const r = validateGeneratedListening(validatorFixture());
    if (!r.ok) {
      throw new Error(
        `expected ok; got issues: ${JSON.stringify(r.issues, null, 2)}`,
      );
    }
  });
});

describe("validateGeneratedListening — position issues", () => {
  it("rejects duplicate position on two question rows", () => {
    const v = validatorFixture() as GeneratedListening;
    v.questions[1]!.position = v.questions[0]!.position;
    const r = validateGeneratedListening(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.issues.some((i) => i.code === "positions.duplicate-on-question"),
      ).toBe(true);
    }
  });

  it("rejects a question position that no part claims", () => {
    const v = validatorFixture() as GeneratedListening;
    v.questions[0]!.position = 99;
    const r = validateGeneratedListening(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.issues.some((i) => i.code === "positions.question-not-in-any-part"),
      ).toBe(true);
    }
  });

  it("rejects a position claimed by two parts", () => {
    const v = validatorFixture() as GeneratedListening;
    v.parts[1]!.question_positions.push(0); // 0 is already claimed by part 1
    const r = validateGeneratedListening(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.issues.some((i) => i.code === "positions.in-multiple-parts"),
      ).toBe(true);
    }
  });

  it("rejects a part position that no question references", () => {
    const v = validatorFixture() as GeneratedListening;
    v.parts[3]!.question_positions.push(50);
    const r = validateGeneratedListening(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.issues.some(
          (i) => i.code === "positions.unreferenced-by-question",
        ),
      ).toBe(true);
    }
  });
});

describe("validateGeneratedListening — speaker + preview issues", () => {
  it("rejects a speech segment referencing an unknown speaker_id", () => {
    const v = validatorFixture() as GeneratedListening;
    const seg = v.parts[0]!.transcript[2];
    if (seg && seg.kind === "speech") {
      seg.speaker_id = "ghost";
    } else {
      throw new Error("fixture mis-shaped");
    }
    const r = validateGeneratedListening(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.issues.some((i) => i.code === "speakers.unknown-speech-reference"),
      ).toBe(true);
    }
  });

  it("rejects a questions-preview that points outside the part", () => {
    const v = validatorFixture() as GeneratedListening;
    const seg = v.parts[0]!.transcript[1];
    if (seg && seg.kind === "questions-preview") {
      seg.question_positions = [99];
    } else {
      throw new Error("fixture mis-shaped");
    }
    const r = validateGeneratedListening(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.issues.some((i) => i.code === "preview.position-outside-part"),
      ).toBe(true);
    }
  });
});

describe("validateGeneratedListening — block + slot issues", () => {
  it("rejects a completion-blank referencing an unknown block_id", () => {
    const v = validatorFixture() as GeneratedListening;
    const q = v.questions[0]!;
    if (q.type === "listening-completion-blank") {
      q.correct_answer.block_id = "nope";
    } else {
      throw new Error("expected completion-blank at index 0");
    }
    const r = validateGeneratedListening(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.issues.some((i) => i.code === "completion-blank.block-not-found"),
      ).toBe(true);
    }
  });

  it("rejects a completion-blank referencing an unknown slot_id within an existing block", () => {
    const v = validatorFixture() as GeneratedListening;
    const q = v.questions[0]!;
    if (q.type === "listening-completion-blank") {
      q.correct_answer.slot_id = "nope";
    } else {
      throw new Error("expected completion-blank at index 0");
    }
    const r = validateGeneratedListening(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.issues.some((i) => i.code === "completion-blank.slot-not-found"),
      ).toBe(true);
    }
  });
});

describe("validateGeneratedListening — answer grounding", () => {
  it("rejects a sentence-completion whose accepted strings aren't in the transcript", () => {
    const v = validatorFixture() as GeneratedListening;
    const q = v.questions[1]!;
    if (q.type === "listening-sentence-completion") {
      q.correct_answer.accepted = ["999"];
    } else {
      throw new Error("expected sentence-completion at index 1");
    }
    const r = validateGeneratedListening(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.issues.some((i) => i.code === "answer.not-in-transcript"),
      ).toBe(true);
    }
  });

  it("does NOT reject an MCQ even when the correct option shares no tokens with the transcript (interpretive paraphrase OK)", () => {
    // Listening MCQ options summarise / paraphrase what speakers said —
    // not literal substrings. The grounding heuristic was carried over
    // from Reading and produced false positives almost every run on
    // Listening output. Hallucination protection is moderation, not a
    // string-match check.
    const v = validatorFixture() as GeneratedListening;
    const q = v.questions[3]!;
    if (q.type === "listening-mcq-single") {
      q.correct_answer.options = [
        { id: "A", text: "fictitious" },
        { id: "B", text: "fantasia" },
      ];
      q.correct_answer.correct = "A";
    } else {
      throw new Error("expected mcq-single at index 3");
    }
    const r = validateGeneratedListening(v);
    expect(r.ok).toBe(true);
  });
});
