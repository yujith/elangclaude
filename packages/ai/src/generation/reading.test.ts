// Contract test for the Reading generation pipeline.
//
// Uses a recorded fixture response — no live network. Covers:
//   - Happy path: model output → schema OK → validator OK → typed result.
//   - Retry on malformed JSON: first response is junk, second is valid.
//   - Schema rejection: both attempts malformed → GenerationShapeError.
//   - Validator rejection: schema OK but answer not in passage →
//     GenerationValidationError.
//   - Track-mismatch: model swapped the track → validation error.

import { describe, expect, it } from "vitest";
import type { OrgContext } from "@elc/db";
import {
  GenerationShapeError,
  GenerationValidationError,
} from "../errors";
import { createReadingGenerator } from "./reading";

const CTX: OrgContext = {
  org_id: "org_1",
  user_id: "super_1",
  role: "SuperAdmin",
};

const PROMPT_BODY = "FAKE READING GENERATION PROMPT";

// A canonical "good" generation: Academic, in the 700–900 word window,
// answers verbatim in the passage. Keep the paragraph texts long enough
// that the validator's word-count check passes. The repeated phrase keeps
// the test deterministic.
const FILLER =
  "The history of paper is a story of slow refinement. " +
  "Several civilisations contributed materials and methods that gradually accumulated into the modern industry. " +
  "Records survive that describe rags, bark, hemp and bamboo as the principal pulp sources. " +
  "By the eighteenth century the supply of rags could not keep pace with demand from printing. " +
  "Industrial chemistry eventually replaced the older recipes with wood-based processes. ";

function repeatToWordCount(min: number): string {
  const target = min + 30;
  let text = "";
  while (text.split(/\s+/).filter(Boolean).length < target) {
    text += FILLER;
  }
  return text;
}

const VALID_GENERATION = {
  track: "Academic" as const,
  difficulty: 5,
  passage: {
    title: "A short history of paper",
    paragraphs: [
      { label: "A", text: repeatToWordCount(150) },
      { label: "B", text: repeatToWordCount(150) },
      { label: "C", text: repeatToWordCount(150) },
      { label: "D", text: repeatToWordCount(150) },
    ],
  },
  questions: [
    {
      type: "reading-mcq" as const,
      position: 0,
      prompt: "Pick the option mentioned in the passage.",
      correct_answer: {
        options: [
          { id: "A", text: "wood-based processes" },
          { id: "B", text: "obviously unrelated fabrication" },
        ],
        correct: "A",
      },
    },
    {
      type: "reading-true-false-not-given" as const,
      position: 1,
      prompt: "The passage discusses paper-making.\n\nTrue / False / Not Given",
      correct_answer: { correct: "true" as const },
    },
    {
      type: "reading-sentence-completion" as const,
      position: 2,
      prompt: "Complete the sentence using NO MORE THAN TWO WORDS from the passage.",
      correct_answer: {
        stem: "Earlier paper-making relied on ___ as a pulp source.",
        word_limit: 2,
        accepted: ["rags"],
      },
    },
    {
      type: "reading-short-answer" as const,
      position: 3,
      prompt: "Which material eventually replaced older recipes?",
      correct_answer: {
        word_limit: 1,
        accepted: ["wood"],
      },
    },
  ],
};

type ChatArg = {
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
};

function makeAi(responses: { text: string }[]) {
  let i = 0;
  const recorded: ChatArg[] = [];
  const chat = async (arg: ChatArg) => {
    recorded.push(arg);
    const next = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return {
      text: next.text,
      model: "google/gemini-2.0-flash-001",
      usage: { input_tokens: 1200, output_tokens: 800 },
    };
  };
  return { chat, recorded, calls: () => i };
}

function loader(): string {
  return PROMPT_BODY;
}

describe("createReadingGenerator", () => {
  it("happy path → typed GeneratedReading on a single call", async () => {
    const ai = makeAi([{ text: JSON.stringify(VALID_GENERATION) }]);
    const gen = createReadingGenerator({ ai, loadPrompt: loader });
    const result = await gen.generate({
      ctx: CTX,
      track: "Academic",
      difficulty: 5,
    });
    expect(result.attempts).toBe(1);
    expect(result.value.track).toBe("Academic");
    expect(result.value.questions).toHaveLength(4);
    // Recorded call used the prompt body as the system message.
    expect(ai.recorded[0]?.system).toBe(PROMPT_BODY);
    // The user turn declared the requested track.
    expect(ai.recorded[0]?.messages[0]?.content).toMatch(/Academic/);
  });

  it("retries once on malformed JSON, then succeeds", async () => {
    const ai = makeAi([
      { text: "Here is the JSON: not actually json" },
      { text: JSON.stringify(VALID_GENERATION) },
    ]);
    const gen = createReadingGenerator({ ai, loadPrompt: loader });
    const result = await gen.generate({
      ctx: CTX,
      track: "Academic",
      difficulty: 5,
    });
    expect(result.attempts).toBe(2);
    expect(ai.calls()).toBe(2);
  });

  it("throws GenerationShapeError after the retry fails", async () => {
    const ai = makeAi([{ text: "nope" }, { text: "still nope" }]);
    const gen = createReadingGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({ ctx: CTX, track: "Academic", difficulty: 5 }),
    ).rejects.toBeInstanceOf(GenerationShapeError);
  });

  it("throws GenerationValidationError when the answer is not in the passage", async () => {
    const broken = {
      ...VALID_GENERATION,
      questions: [
        VALID_GENERATION.questions[0]!,
        VALID_GENERATION.questions[1]!,
        {
          ...VALID_GENERATION.questions[2]!,
          correct_answer: {
            stem: "Earlier paper-making relied on ___ as a pulp source.",
            word_limit: 2,
            accepted: ["unobtainium"], // not in the passage
          },
        },
        VALID_GENERATION.questions[3]!,
      ],
    };
    const ai = makeAi([{ text: JSON.stringify(broken) }]);
    const gen = createReadingGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({ ctx: CTX, track: "Academic", difficulty: 5 }),
    ).rejects.toBeInstanceOf(GenerationValidationError);
  });

  it("throws GenerationValidationError when the passage is too short", async () => {
    // Each paragraph passes the schema's min character length (80) but the
    // combined word count is well under the Academic 600-word minimum.
    const minLengthFiller =
      "This single paragraph is just long enough to satisfy the strict schema minimum length of eighty characters, but the cumulative word count across the three short paragraphs is well under the Academic six-hundred-word floor enforced by the content validator. ";
    const tooShort = {
      ...VALID_GENERATION,
      passage: {
        title: "Too short",
        paragraphs: [
          { label: "A", text: minLengthFiller },
          { label: "B", text: minLengthFiller },
          { label: "C", text: minLengthFiller },
        ],
      },
    };
    const ai = makeAi([{ text: JSON.stringify(tooShort) }]);
    const gen = createReadingGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({ ctx: CTX, track: "Academic", difficulty: 5 }),
    ).rejects.toBeInstanceOf(GenerationValidationError);
  });

  it("rejects a track mismatch (model returned GT when Academic was requested)", async () => {
    const swapped = { ...VALID_GENERATION, track: "GeneralTraining" as const };
    const ai = makeAi([{ text: JSON.stringify(swapped) }]);
    const gen = createReadingGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({ ctx: CTX, track: "Academic", difficulty: 5 }),
    ).rejects.toBeInstanceOf(GenerationValidationError);
  });

  it("includes the topic hint in the user turn when provided", async () => {
    const ai = makeAi([{ text: JSON.stringify(VALID_GENERATION) }]);
    const gen = createReadingGenerator({ ai, loadPrompt: loader });
    await gen.generate({
      ctx: CTX,
      track: "Academic",
      difficulty: 5,
      topicHint: "the history of refrigeration",
    });
    expect(ai.recorded[0]?.messages[0]?.content).toMatch(/refrigeration/);
  });
});
