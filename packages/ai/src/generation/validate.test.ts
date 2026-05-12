import { describe, expect, it } from "vitest";
import { validateGeneratedReading } from "./validate";
import type { GeneratedReading } from "./schema";

const PASSAGE_TEXT =
  "The history of paper begins with rags and bark. " +
  "By the eighteenth century the supply of rags could not keep pace with demand from printing. " +
  "Industrial chemistry eventually replaced the older recipes with wood-based processes by 1843. " +
  "Modern paper-making in 2024 still relies on the same physical principles.";

function bigParagraph(text: string, repeat: number): string {
  return Array.from({ length: repeat }, () => text).join(" ");
}

function baseAcademicValue(): GeneratedReading {
  return {
    track: "Academic",
    difficulty: 5,
    passage: {
      title: "A short history of paper",
      paragraphs: [
        { label: "A", text: bigParagraph(PASSAGE_TEXT, 5) },
        { label: "B", text: bigParagraph(PASSAGE_TEXT, 5) },
        { label: "C", text: bigParagraph(PASSAGE_TEXT, 5) },
      ],
    },
    questions: [
      {
        type: "reading-sentence-completion",
        position: 0,
        prompt: "Complete the sentence in 2 words.",
        correct_answer: {
          stem: "Earlier paper-making relied on ___ as a pulp source.",
          word_limit: 2,
          accepted: ["rags"],
        },
      },
      {
        type: "reading-mcq",
        position: 1,
        prompt: "What replaced older recipes?",
        correct_answer: {
          options: [
            { id: "A", text: "wood-based processes" },
            { id: "B", text: "papyrus reeds" },
          ],
          correct: "A",
        },
      },
    ],
  };
}

describe("validateGeneratedReading", () => {
  it("passes a well-formed Academic generation", () => {
    const r = validateGeneratedReading(baseAcademicValue());
    expect(r.ok).toBe(true);
  });

  it("rejects a passage shorter than the Academic minimum", () => {
    const v = baseAcademicValue();
    v.passage.paragraphs = [
      { label: "A", text: "Far too short to qualify." },
      { label: "B", text: "Also too short." },
      { label: "C", text: "Likewise minimal." },
    ];
    const r = validateGeneratedReading(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "passage.too-short")).toBe(true);
    }
  });

  it("rejects when a sentence-completion accepted string is not in the passage", () => {
    const v = baseAcademicValue();
    if (v.questions[0]!.type === "reading-sentence-completion") {
      v.questions[0]!.correct_answer.accepted = ["unobtainium"];
    }
    const r = validateGeneratedReading(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.issues.some((i) => i.code === "completion.answer-not-in-passage"),
      ).toBe(true);
    }
  });

  it("rejects an MCQ correct option that shares no substantive tokens with the passage", () => {
    const v = baseAcademicValue();
    if (v.questions[1]!.type === "reading-mcq") {
      v.questions[1]!.correct_answer.options[0]!.text =
        "completely unrelated phantasm";
    }
    const r = validateGeneratedReading(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "mcq.correct-not-grounded")).toBe(
        true,
      );
    }
  });

  it("accepts a numeric MCQ answer when the digit is in the passage", () => {
    const v = baseAcademicValue();
    if (v.questions[1]!.type === "reading-mcq") {
      v.questions[1]!.correct_answer.options[0]!.text = "1843";
      v.questions[1]!.correct_answer.correct = "A";
    }
    const r = validateGeneratedReading(v);
    expect(r.ok).toBe(true);
  });

  it("uses the GT window for GeneralTraining", () => {
    const v = baseAcademicValue();
    v.track = "GeneralTraining";
    // Shrink the passage to ~150 words — below GT's 400-word minimum.
    v.passage.paragraphs = [
      { label: "A", text: PASSAGE_TEXT },
      { label: "B", text: PASSAGE_TEXT },
    ];
    const r = validateGeneratedReading(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "passage.too-short")).toBe(true);
    }
  });
});
