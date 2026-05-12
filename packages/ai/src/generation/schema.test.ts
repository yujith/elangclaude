import { describe, expect, it } from "vitest";
import { parseGeneratedReading } from "./schema";

const MIN_PARAGRAPH_TEXT =
  "This paragraph is just long enough to satisfy the schema's minimum length requirement of eighty characters.";

const MIN_VALID = {
  track: "Academic",
  difficulty: 5,
  passage: {
    title: "Title",
    paragraphs: [
      { label: "A", text: MIN_PARAGRAPH_TEXT },
      { label: "B", text: MIN_PARAGRAPH_TEXT },
      { label: "C", text: MIN_PARAGRAPH_TEXT },
    ],
  },
  questions: [
    {
      type: "reading-true-false-not-given",
      position: 0,
      prompt: "Is the passage about paper?\n\nTrue / False / Not Given",
      correct_answer: { correct: "true" },
    },
    {
      type: "reading-true-false-not-given",
      position: 1,
      prompt: "Same question repeated for schema purposes.",
      correct_answer: { correct: "false" },
    },
    {
      type: "reading-true-false-not-given",
      position: 2,
      prompt: "And once more for the minimum.",
      correct_answer: { correct: "not given" },
    },
    {
      type: "reading-true-false-not-given",
      position: 3,
      prompt: "Last filler question to hit the array minimum.",
      correct_answer: { correct: "true" },
    },
  ],
};

describe("parseGeneratedReading", () => {
  it("accepts a minimal valid object", () => {
    const r = parseGeneratedReading(JSON.stringify(MIN_VALID));
    expect(r.ok).toBe(true);
  });

  it("extracts the JSON when the model prefaced it with text", () => {
    const raw = `Here is the output:\n${JSON.stringify(MIN_VALID)}\nThanks.`;
    const r = parseGeneratedReading(raw);
    expect(r.ok).toBe(true);
  });

  it("rejects malformed JSON", () => {
    const r = parseGeneratedReading("not actually json");
    expect(r.ok).toBe(false);
  });

  it("rejects when MCQ correct is not in the options", () => {
    const bad = JSON.parse(JSON.stringify(MIN_VALID));
    bad.questions[0] = {
      type: "reading-mcq",
      position: 0,
      prompt: "Pick.",
      correct_answer: {
        options: [
          { id: "A", text: "alpha" },
          { id: "B", text: "beta" },
        ],
        correct: "Z", // not in options
      },
    };
    const r = parseGeneratedReading(JSON.stringify(bad));
    expect(r.ok).toBe(false);
  });

  it("rejects sentence-completion stems without ___", () => {
    const bad = JSON.parse(JSON.stringify(MIN_VALID));
    bad.questions[0] = {
      type: "reading-sentence-completion",
      position: 0,
      prompt: "Complete.",
      correct_answer: {
        stem: "No blank marker here.",
        word_limit: 2,
        accepted: ["paper"],
      },
    };
    const r = parseGeneratedReading(JSON.stringify(bad));
    expect(r.ok).toBe(false);
  });

  it("rejects an unsupported question type", () => {
    const bad = JSON.parse(JSON.stringify(MIN_VALID));
    bad.questions[0] = {
      type: "reading-matching-headings",
      position: 0,
      prompt: "Paragraph A",
      correct_answer: { group_id: "g", correct: "i" },
    };
    const r = parseGeneratedReading(JSON.stringify(bad));
    expect(r.ok).toBe(false);
  });
});
