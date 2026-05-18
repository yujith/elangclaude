import { describe, expect, it } from "vitest";
import type { GeneratedListening } from "./listening-schema";
import {
  cleanGeneratedListening,
  validateGeneratedListening,
} from "./listening-validate";
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

  it("rejects two completion-blank questions claiming the same (block, slot) pair", () => {
    const v = validatorFixture() as GeneratedListening;
    const original = v.questions[0]!;
    if (original.type !== "listening-completion-blank") {
      throw new Error("expected completion-blank at index 0");
    }
    // Inject a second completion-blank question that points at the
    // same (block, slot). Its position is added to Part 1 so the
    // earlier positions check doesn't blow up.
    const duplicateQuestion = {
      type: "listening-completion-blank" as const,
      position: 99,
      prompt: "Duplicate slot claim",
      points: 1,
      correct_answer: {
        block_id: original.correct_answer.block_id,
        slot_id: original.correct_answer.slot_id,
        word_limit: original.correct_answer.word_limit,
        accepted: original.correct_answer.accepted,
      },
    };
    v.questions.push(duplicateQuestion);
    v.parts[0]!.question_positions.push(99);

    const r = validateGeneratedListening(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.issues.some(
          (i) => i.code === "completion-blank.slot-already-claimed",
        ),
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

describe("cleanGeneratedListening", () => {
  it("is a no-op when every question is grounded", () => {
    const v = validatorFixture();
    const r = cleanGeneratedListening(v);
    expect(r.droppedQuestions).toEqual([]);
    expect(r.cleaned.questions.length).toBe(v.questions.length);
  });

  it("drops a sentence-completion whose accepted answer isn't in the transcript", () => {
    const v = validatorFixture();
    const q = v.questions[1]!;
    if (q.type === "listening-sentence-completion") {
      q.correct_answer.accepted = ["nonexistent-token-9999"];
    } else {
      throw new Error("expected sentence-completion at index 1");
    }
    const r = cleanGeneratedListening(v);
    expect(r.droppedQuestions).toHaveLength(1);
    expect(r.droppedQuestions[0]!.reason).toBe("answer-not-in-transcript");
    expect(r.cleaned.questions.length).toBe(v.questions.length - 1);
  });

  it("also strips the dropped position from the parent part's question_positions", () => {
    const v = validatorFixture();
    const q = v.questions[2]!;
    const droppedPosition = q.position;
    if (q.type === "listening-short-answer") {
      q.correct_answer.accepted = ["nonexistent-9999"];
    } else {
      throw new Error("expected short-answer at index 2");
    }
    const r = cleanGeneratedListening(v);
    for (const part of r.cleaned.parts) {
      expect(part.question_positions).not.toContain(droppedPosition);
    }
  });

  it("drops a completion-blank with an unknown block_id and notes the reason", () => {
    const v = validatorFixture();
    const q = v.questions[0]!;
    if (q.type === "listening-completion-blank") {
      q.correct_answer.block_id = "nonexistent-block";
    } else {
      throw new Error("expected completion-blank at index 0");
    }
    const r = cleanGeneratedListening(v);
    expect(r.droppedQuestions).toHaveLength(1);
    expect(r.droppedQuestions[0]!.reason).toBe(
      "completion-blank-block-not-found",
    );
  });

  it("drops a duplicate-slot completion-blank (keeps the first, drops the second)", () => {
    const v = validatorFixture();
    const first = v.questions[0]!;
    if (first.type !== "listening-completion-blank") {
      throw new Error("expected completion-blank at index 0");
    }
    const droppedPosition = 99;
    v.questions.push({
      type: "listening-completion-blank" as const,
      position: droppedPosition,
      prompt: "Duplicate slot claim",
      points: 1,
      correct_answer: {
        block_id: first.correct_answer.block_id,
        slot_id: first.correct_answer.slot_id,
        word_limit: first.correct_answer.word_limit,
        accepted: first.correct_answer.accepted,
      },
    });
    v.parts[0]!.question_positions.push(droppedPosition);

    const r = cleanGeneratedListening(v);
    expect(r.droppedQuestions).toHaveLength(1);
    expect(r.droppedQuestions[0]!.reason).toBe(
      "completion-blank-slot-already-claimed",
    );
    expect(r.droppedQuestions[0]!.position).toBe(droppedPosition);
    // The first claimant survives.
    expect(
      r.cleaned.questions.some((q) => q.position === first.position),
    ).toBe(true);
  });

  it("prunes orphan question_positions that no question backs (model declared too many slots)", () => {
    const v = validatorFixture();
    // Model declared an extra position in part 1 but never wrote the
    // matching question. This is what trips
    // 'positions.unreferenced-by-question' in raw validation.
    v.parts[0]!.question_positions.push(999);
    // Also reference it from a questions-preview segment so we can
    // verify the segment gets cleaned too.
    const preview = v.parts[0]!.transcript.find(
      (s) => s.kind === "questions-preview",
    );
    if (!preview || preview.kind !== "questions-preview") {
      throw new Error("fixture missing questions-preview in part 1");
    }
    preview.question_positions.push(999);

    const r = cleanGeneratedListening(v);
    // No question was dropped (the orphan was never a question to begin with).
    expect(r.droppedQuestions).toEqual([]);
    // The orphan position is gone from question_positions.
    expect(r.cleaned.parts[0]!.question_positions).not.toContain(999);
    // And from the preview segment.
    const cleanedPreview = r.cleaned.parts[0]!.transcript.find(
      (s) => s.kind === "questions-preview",
    );
    if (cleanedPreview && cleanedPreview.kind === "questions-preview") {
      expect(cleanedPreview.question_positions).not.toContain(999);
    }
    // The pruned content now validates cleanly.
    const validation = validateGeneratedListening(r.cleaned);
    expect(validation.ok).toBe(true);
  });

  it("never drops MCQ questions even with weirdly-worded options", () => {
    const v = validatorFixture();
    const q = v.questions[3]!;
    if (q.type === "listening-mcq-single") {
      q.correct_answer.options = [
        { id: "A", text: "fictitious" },
        { id: "B", text: "fantasia" },
      ];
      q.correct_answer.correct = "A";
    }
    const r = cleanGeneratedListening(v);
    expect(r.droppedQuestions).toEqual([]);
  });

  it("strips dropped positions from questions-preview segments too", () => {
    const v = validatorFixture();
    const q = v.questions[1]!;
    const droppedPosition = q.position;
    if (q.type === "listening-sentence-completion") {
      q.correct_answer.accepted = ["nonexistent-9999"];
    } else {
      throw new Error("expected sentence-completion at index 1");
    }
    const r = cleanGeneratedListening(v);
    for (const part of r.cleaned.parts) {
      for (const seg of part.transcript) {
        if (seg.kind === "questions-preview") {
          expect(seg.question_positions).not.toContain(droppedPosition);
        }
      }
    }
  });
});
