import { describe, expect, it } from "vitest";
import { sampleListeningQuestions } from "./fixtures";
import {
  isListeningQuestionKind,
  parseListeningQuestionPayload,
  parseListeningResponse,
  LISTENING_QUESTION_KINDS,
} from "./question-types";

describe("LISTENING_QUESTION_KINDS — surface", () => {
  it("recognises every Phase 1 kind", () => {
    for (const k of [
      "listening-mcq-single",
      "listening-mcq-multi",
      "listening-sentence-completion",
      "listening-short-answer",
      "listening-completion-blank",
    ]) {
      expect(LISTENING_QUESTION_KINDS.has(k)).toBe(true);
      expect(isListeningQuestionKind(k)).toBe(true);
    }
  });

  it("does NOT recognise out-of-phase kinds (matching, plan-map)", () => {
    expect(isListeningQuestionKind("listening-matching")).toBe(false);
    expect(isListeningQuestionKind("listening-plan-map-diagram-label")).toBe(false);
  });
});

describe("parseListeningQuestionPayload — fixture round-trip", () => {
  it("round-trips every fixture question through its parser", () => {
    for (const q of sampleListeningQuestions) {
      const parsed = parseListeningQuestionPayload(q.type, q.correct_answer);
      expect(parsed, `position ${q.position} (${q.type})`).toEqual(
        q.correct_answer,
      );
    }
  });

  it("covers all 5 Phase 1 kinds via the fixture", () => {
    const kinds = new Set(sampleListeningQuestions.map((q) => q.type));
    expect(kinds).toEqual(
      new Set([
        "listening-mcq-single",
        "listening-mcq-multi",
        "listening-sentence-completion",
        "listening-short-answer",
        "listening-completion-blank",
      ]),
    );
  });
});

describe("listening-mcq-single — rejections", () => {
  const valid = {
    options: [
      { id: "A", text: "Alpha" },
      { id: "B", text: "Beta" },
    ],
    correct: "A",
  };

  it("rejects a correct id that isn't one of the options", () => {
    expect(
      parseListeningQuestionPayload("listening-mcq-single", {
        ...valid,
        correct: "Z",
      }),
    ).toBeNull();
  });

  it("rejects fewer than 2 options", () => {
    expect(
      parseListeningQuestionPayload("listening-mcq-single", {
        options: [{ id: "A", text: "Alone" }],
        correct: "A",
      }),
    ).toBeNull();
  });

  it("rejects duplicate option ids", () => {
    expect(
      parseListeningQuestionPayload("listening-mcq-single", {
        options: [
          { id: "A", text: "Alpha" },
          { id: "A", text: "Apple" },
        ],
        correct: "A",
      }),
    ).toBeNull();
  });
});

describe("listening-mcq-multi — rejections", () => {
  const valid = {
    options: [
      { id: "A", text: "Alpha" },
      { id: "B", text: "Beta" },
      { id: "C", text: "Gamma" },
      { id: "D", text: "Delta" },
      { id: "E", text: "Epsilon" },
    ],
    pick_count: 2,
    correct: ["A", "B"],
  };

  it("accepts a well-formed multi", () => {
    expect(
      parseListeningQuestionPayload("listening-mcq-multi", valid),
    ).toMatchObject({
      kind: "listening-mcq-multi",
      pick_count: 2,
      correct: ["A", "B"],
    });
  });

  it("rejects pick_count that doesn't match correct.length", () => {
    expect(
      parseListeningQuestionPayload("listening-mcq-multi", {
        ...valid,
        pick_count: 3,
      }),
    ).toBeNull();
  });

  it("rejects correct referencing an unknown option id", () => {
    expect(
      parseListeningQuestionPayload("listening-mcq-multi", {
        ...valid,
        correct: ["A", "Z"],
      }),
    ).toBeNull();
  });

  it("rejects duplicates in correct", () => {
    expect(
      parseListeningQuestionPayload("listening-mcq-multi", {
        ...valid,
        correct: ["A", "A"],
      }),
    ).toBeNull();
  });

  it("rejects pick_count >= options.length (no distractor)", () => {
    expect(
      parseListeningQuestionPayload("listening-mcq-multi", {
        options: valid.options.slice(0, 2),
        pick_count: 2,
        correct: ["A", "B"],
      }),
    ).toBeNull();
  });

  it("rejects fewer than 2 correct (collapses into mcq-single semantics)", () => {
    expect(
      parseListeningQuestionPayload("listening-mcq-multi", {
        ...valid,
        pick_count: 1,
        correct: ["A"],
      }),
    ).toBeNull();
  });
});

describe("listening-sentence-completion — rejections", () => {
  const valid = {
    stem: "The clock has only ___ hand.",
    word_limit: 2,
    accepted: ["one"],
  };

  it("rejects a stem without the ___ blank marker", () => {
    expect(
      parseListeningQuestionPayload("listening-sentence-completion", {
        ...valid,
        stem: "There is no blank here.",
      }),
    ).toBeNull();
  });

  it("rejects a word_limit out of bounds", () => {
    expect(
      parseListeningQuestionPayload("listening-sentence-completion", {
        ...valid,
        word_limit: 0,
      }),
    ).toBeNull();
    expect(
      parseListeningQuestionPayload("listening-sentence-completion", {
        ...valid,
        word_limit: 11,
      }),
    ).toBeNull();
  });

  it("rejects an empty accepted array", () => {
    expect(
      parseListeningQuestionPayload("listening-sentence-completion", {
        ...valid,
        accepted: [],
      }),
    ).toBeNull();
  });
});

describe("listening-short-answer — rejections", () => {
  it("rejects a non-integer word_limit", () => {
    expect(
      parseListeningQuestionPayload("listening-short-answer", {
        word_limit: 2.5,
        accepted: ["yes"],
      }),
    ).toBeNull();
  });

  it("rejects accepted with a non-string element", () => {
    expect(
      parseListeningQuestionPayload("listening-short-answer", {
        word_limit: 3,
        accepted: ["yes", 7],
      }),
    ).toBeNull();
  });
});

describe("listening-completion-blank — rejections", () => {
  it("requires block_id and slot_id", () => {
    expect(
      parseListeningQuestionPayload("listening-completion-blank", {
        block_id: "",
        slot_id: "x",
        word_limit: 2,
        accepted: ["yes"],
      }),
    ).toBeNull();
    expect(
      parseListeningQuestionPayload("listening-completion-blank", {
        block_id: "x",
        slot_id: "",
        word_limit: 2,
        accepted: ["yes"],
      }),
    ).toBeNull();
  });
});

describe("parseListeningResponse", () => {
  it("parses an mcq-single response with a selected id", () => {
    expect(
      parseListeningResponse("listening-mcq-single", { selected: "A" }),
    ).toEqual({ kind: "listening-mcq-single", selected: "A" });
  });

  it("parses an mcq-single response with null (no answer)", () => {
    expect(
      parseListeningResponse("listening-mcq-single", { selected: null }),
    ).toEqual({ kind: "listening-mcq-single", selected: null });
  });

  it("rejects an mcq-single response missing the selected field", () => {
    expect(parseListeningResponse("listening-mcq-single", {})).toBeNull();
  });

  it("parses an mcq-multi response as an array", () => {
    expect(
      parseListeningResponse("listening-mcq-multi", { selected: ["A", "B"] }),
    ).toEqual({ kind: "listening-mcq-multi", selected: ["A", "B"] });
  });

  it("parses an mcq-multi response with an empty array (no answer)", () => {
    expect(
      parseListeningResponse("listening-mcq-multi", { selected: [] }),
    ).toEqual({ kind: "listening-mcq-multi", selected: [] });
  });

  it("rejects an mcq-multi response whose selected isn't an array", () => {
    expect(
      parseListeningResponse("listening-mcq-multi", { selected: "A" }),
    ).toBeNull();
  });

  it("parses text-kind responses, defaulting missing text to empty string", () => {
    for (const kind of [
      "listening-sentence-completion",
      "listening-short-answer",
      "listening-completion-blank",
    ]) {
      expect(parseListeningResponse(kind, { text: "answer" })).toEqual({
        kind,
        text: "answer",
      });
      expect(parseListeningResponse(kind, {})).toEqual({ kind, text: "" });
    }
  });

  it("returns null for an unknown question kind", () => {
    expect(parseListeningResponse("listening-matching", { selected: "A" })).toBeNull();
  });

  it("returns null for a non-object response", () => {
    expect(parseListeningResponse("listening-mcq-single", "A")).toBeNull();
    expect(parseListeningResponse("listening-mcq-single", null)).toBeNull();
  });
});
