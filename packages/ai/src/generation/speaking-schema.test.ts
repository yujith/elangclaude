import { describe, expect, it } from "vitest";
import { parseGeneratedSpeaking } from "./speaking-schema";

const VALID = {
  section: "speaking",
  track: "Academic",
  difficulty: 3,
  topic_domain: "books and reading",
  part1: {
    theme: "Daily life and reading habits",
    subtopics: [
      {
        topic: "Hometown",
        questions: [
          "Where is your hometown?",
          "What do you like about it?",
          "Would you like to live there in the future?",
        ],
      },
      {
        topic: "Work or study",
        questions: [
          "Do you work or study?",
          "Why did you choose that field?",
          "What do you find difficult about it?",
        ],
      },
      {
        topic: "Reading",
        questions: [
          "Do you enjoy reading?",
          "What kind of books do you like?",
          "When do you usually read?",
        ],
      },
    ],
  },
  part2: {
    cue_card_topic: "Describe a book you recently read and enjoyed.",
    bullets: [
      "what the book was about",
      "when and where you read it",
      "why you decided to read it",
    ],
    final_prompt: "and explain why you found it memorable.",
    followup_questions: [
      "Did you recommend it to anyone?",
      "Would you read it again?",
    ],
  },
  part3: {
    theme: "Reading and society",
    questions: [
      "Why do you think reading habits have changed in recent years?",
      "How important is it for children to read for pleasure?",
      "Do you think printed books will disappear in the future?",
      "What role should libraries play in a community?",
    ],
  },
};

describe("parseGeneratedSpeaking", () => {
  it("parses a well-formed test", () => {
    const res = parseGeneratedSpeaking(JSON.stringify(VALID));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.section).toBe("speaking");
      expect(res.value.part1.subtopics).toHaveLength(3);
      expect(res.value.part2.bullets).toHaveLength(3);
      expect(res.value.part3.questions).toHaveLength(4);
    }
  });

  it("strips provider preamble before the JSON object", () => {
    const res = parseGeneratedSpeaking(
      `Here is the test you asked for:\n${JSON.stringify(VALID)}`,
    );
    expect(res.ok).toBe(true);
  });

  it("rejects a response with no JSON object", () => {
    const res = parseGeneratedSpeaking("no json here");
    expect(res.ok).toBe(false);
  });

  it("rejects invalid JSON", () => {
    const res = parseGeneratedSpeaking("{ not: valid json ");
    expect(res.ok).toBe(false);
  });

  it("rejects a wrong section marker", () => {
    const res = parseGeneratedSpeaking(
      JSON.stringify({ ...VALID, section: "writing" }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects too few Part 1 subtopics", () => {
    const res = parseGeneratedSpeaking(
      JSON.stringify({
        ...VALID,
        part1: { ...VALID.part1, subtopics: VALID.part1.subtopics.slice(0, 2) },
      }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects too few cue-card bullets", () => {
    const res = parseGeneratedSpeaking(
      JSON.stringify({
        ...VALID,
        part2: { ...VALID.part2, bullets: ["only one"] },
      }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects fewer than four Part 3 questions", () => {
    const res = parseGeneratedSpeaking(
      JSON.stringify({
        ...VALID,
        part3: { ...VALID.part3, questions: VALID.part3.questions.slice(0, 3) },
      }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects unknown top-level keys (strict)", () => {
    const res = parseGeneratedSpeaking(
      JSON.stringify({ ...VALID, unexpected: "field" }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects a difficulty outside 1–5", () => {
    const res = parseGeneratedSpeaking(
      JSON.stringify({ ...VALID, difficulty: 7 }),
    );
    expect(res.ok).toBe(false);
  });
});
