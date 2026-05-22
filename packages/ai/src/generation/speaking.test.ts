// Contract test for the Speaking generation pipeline.
//
// Uses recorded fixture responses — no live network. Covers:
//   - Happy path: model output → schema → validator → result.
//   - Retry on malformed JSON: first response junk, second valid.
//   - Schema rejection: both attempts malformed → GenerationShapeError.
//   - Validator rejection: schema OK but cue card not a "Describe …" prompt.
//   - track mismatch against the request.
//   - topic hint threaded into the user turn.

import { describe, expect, it } from "vitest";
import type { OrgContext } from "@elc/db";
import {
  GenerationShapeError,
  GenerationValidationError,
} from "../errors";
import { createSpeakingGenerator } from "./speaking";

const CTX: OrgContext = {
  org_id: "org_1",
  user_id: "super_1",
  role: "SuperAdmin",
};

const PROMPT_BODY = "FAKE SPEAKING GENERATION PROMPT";

const VALID = {
  section: "speaking" as const,
  track: "Academic" as const,
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
      usage: { input_tokens: 1100, output_tokens: 700 },
    };
  };
  return { chat, recorded, calls: () => i };
}

function loader(): string {
  return PROMPT_BODY;
}

describe("createSpeakingGenerator", () => {
  it("happy path → typed GeneratedSpeaking", async () => {
    const ai = makeAi([{ text: JSON.stringify(VALID) }]);
    const gen = createSpeakingGenerator({ ai, loadPrompt: loader });
    const result = await gen.generate({
      ctx: CTX,
      track: "Academic",
      difficulty: 3,
    });
    expect(result.attempts).toBe(1);
    expect(result.value.section).toBe("speaking");
    expect(result.value.track).toBe("Academic");
    expect(result.value.part2.cue_card_topic).toMatch(/^Describe/);
    expect(ai.recorded[0]?.system).toBe(PROMPT_BODY);
    expect(ai.recorded[0]?.messages[0]?.content).toMatch(/Academic/);
  });

  it("retries once on malformed JSON, then succeeds", async () => {
    const ai = makeAi([
      { text: "Here is the test: not actually json" },
      { text: JSON.stringify(VALID) },
    ]);
    const gen = createSpeakingGenerator({ ai, loadPrompt: loader });
    const result = await gen.generate({
      ctx: CTX,
      track: "Academic",
      difficulty: 3,
    });
    expect(result.attempts).toBe(2);
    expect(ai.calls()).toBe(2);
  });

  it("throws GenerationShapeError after the retry fails", async () => {
    const ai = makeAi([{ text: "nope" }, { text: "still nope" }]);
    const gen = createSpeakingGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({ ctx: CTX, track: "Academic", difficulty: 3 }),
    ).rejects.toBeInstanceOf(GenerationShapeError);
  });

  it("throws GenerationValidationError when the cue card is malformed", async () => {
    const broken = {
      ...VALID,
      part2: { ...VALID.part2, cue_card_topic: "A book I enjoyed reading." },
    };
    const ai = makeAi([{ text: JSON.stringify(broken) }]);
    const gen = createSpeakingGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({ ctx: CTX, track: "Academic", difficulty: 3 }),
    ).rejects.toBeInstanceOf(GenerationValidationError);
  });

  it("rejects a track mismatch against the request", async () => {
    const ai = makeAi([
      { text: JSON.stringify({ ...VALID, track: "GeneralTraining" }) },
    ]);
    const gen = createSpeakingGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({ ctx: CTX, track: "Academic", difficulty: 3 }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "track.mismatch" })],
    });
  });

  it("includes the topic hint in the user turn when provided", async () => {
    const ai = makeAi([{ text: JSON.stringify(VALID) }]);
    const gen = createSpeakingGenerator({ ai, loadPrompt: loader });
    await gen.generate({
      ctx: CTX,
      track: "Academic",
      difficulty: 3,
      topicHint: "neighbourhoods and community",
    });
    expect(ai.recorded[0]?.messages[0]?.content).toMatch(
      /neighbourhoods and community/,
    );
  });
});
