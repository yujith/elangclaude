// Contract test for the Listening generation pipeline. Uses recorded
// fixture responses — no live network. Covers:
//   - Happy path: model output → schema OK → validator OK → typed result.
//   - Retry on malformed JSON: first response is junk, second is valid.
//   - Schema rejection: both attempts malformed → GenerationShapeError.
//   - Validator rejection: schema OK but answer not in transcript →
//     GenerationValidationError.
//   - Track-mismatch: model swapped the track → validation error.
//   - Topic hint surfaces in the user turn.

import { describe, expect, it } from "vitest";
import type { OrgContext } from "@elc/db";
import {
  GenerationShapeError,
  GenerationValidationError,
} from "../errors";
import { createListeningGenerator } from "./listening";
import { validatorCleanGeneration } from "./listening-test-fixtures";

const CTX: OrgContext = {
  org_id: "org_1",
  user_id: "super_1",
  role: "SuperAdmin",
};

const PROMPT_BODY = "FAKE LISTENING GENERATION PROMPT";

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
      usage: { input_tokens: 1800, output_tokens: 2400 },
    };
  };
  return { chat, recorded, calls: () => i };
}

function loader(): string {
  return PROMPT_BODY;
}

describe("createListeningGenerator — happy path", () => {
  it("returns a typed GeneratedListening on a single call", async () => {
    const ai = makeAi([{ text: JSON.stringify(validatorCleanGeneration()) }]);
    const gen = createListeningGenerator({ ai, loadPrompt: loader });
    const result = await gen.generate({
      ctx: CTX,
      track: "Academic",
      difficulty: 3,
    });
    expect(result.attempts).toBe(1);
    expect(result.value.parts).toHaveLength(4);
    expect(result.value.questions.length).toBeGreaterThanOrEqual(12);
    expect(ai.recorded[0]?.system).toBe(PROMPT_BODY);
    expect(ai.recorded[0]?.messages[0]?.content).toMatch(/Academic/);
  });
});

describe("createListeningGenerator — retry", () => {
  it("retries once on malformed JSON, then succeeds", async () => {
    const ai = makeAi([
      { text: "I had thoughts; here you go: not actually JSON" },
      { text: JSON.stringify(validatorCleanGeneration()) },
    ]);
    const gen = createListeningGenerator({ ai, loadPrompt: loader });
    const result = await gen.generate({
      ctx: CTX,
      track: "Academic",
      difficulty: 3,
    });
    expect(result.attempts).toBe(2);
    expect(ai.calls()).toBe(2);
  });

  it("throws GenerationShapeError after the retry also fails", async () => {
    const ai = makeAi([{ text: "nope" }, { text: "still nope" }]);
    const gen = createListeningGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({ ctx: CTX, track: "Academic", difficulty: 3 }),
    ).rejects.toBeInstanceOf(GenerationShapeError);
  });
});

describe("createListeningGenerator — validation", () => {
  it("silently drops an ungrounded answer (cleaner) rather than rejecting the whole section", async () => {
    const broken = validatorCleanGeneration();
    const q = broken.questions[1]!;
    const droppedPosition = q.position;
    if (q.type === "listening-sentence-completion") {
      q.correct_answer.accepted = ["unobtainium"];
    } else {
      throw new Error("expected sentence-completion at index 1 of fixture");
    }
    const ai = makeAi([{ text: JSON.stringify(broken) }]);
    const gen = createListeningGenerator({ ai, loadPrompt: loader });
    const result = await gen.generate({
      ctx: CTX,
      track: "Academic",
      difficulty: 3,
    });
    // The bad question is gone; the rest of the section ships.
    expect(result.value.questions.length).toBe(broken.questions.length - 1);
    expect(
      result.value.questions.some((q) => q.position === droppedPosition),
    ).toBe(false);
    expect(result.droppedQuestions).toHaveLength(1);
    expect(result.droppedQuestions[0]!.reason).toBe(
      "answer-not-in-transcript",
    );
  });

  it("does reject if the cleaner has to drop so many questions that fewer than 10 remain", async () => {
    const broken = validatorCleanGeneration();
    // Wipe accepted strings on every completion-style question — cleaner
    // ends up dropping more than we can spare.
    for (const q of broken.questions) {
      if (
        q.type === "listening-sentence-completion" ||
        q.type === "listening-short-answer" ||
        q.type === "listening-completion-blank"
      ) {
        q.correct_answer.accepted = ["nonexistent-9999"];
      }
    }
    const ai = makeAi([{ text: JSON.stringify(broken) }]);
    const gen = createListeningGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({ ctx: CTX, track: "Academic", difficulty: 3 }),
    ).rejects.toBeInstanceOf(GenerationValidationError);
  });

  it("rejects a track mismatch (model returned GT when Academic was requested)", async () => {
    const swapped = validatorCleanGeneration();
    swapped.track = "GeneralTraining";
    const ai = makeAi([{ text: JSON.stringify(swapped) }]);
    const gen = createListeningGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({ ctx: CTX, track: "Academic", difficulty: 3 }),
    ).rejects.toBeInstanceOf(GenerationValidationError);
  });
});

describe("createListeningGenerator — user turn", () => {
  it("includes the topic hint when provided", async () => {
    const ai = makeAi([{ text: JSON.stringify(validatorCleanGeneration()) }]);
    const gen = createListeningGenerator({ ai, loadPrompt: loader });
    await gen.generate({
      ctx: CTX,
      track: "Academic",
      difficulty: 3,
      topicHint: "the history of clockmaking",
    });
    expect(ai.recorded[0]?.messages[0]?.content).toMatch(/clockmaking/);
  });

  it("declares the requested track + difficulty in the user turn", async () => {
    const gt = validatorCleanGeneration();
    gt.track = "GeneralTraining";
    const ai = makeAi([{ text: JSON.stringify(gt) }]);
    const gen = createListeningGenerator({ ai, loadPrompt: loader });
    await gen.generate({
      ctx: CTX,
      track: "GeneralTraining",
      difficulty: 4,
    });
    const content = ai.recorded[0]?.messages[0]?.content ?? "";
    expect(content).toMatch(/General Training/);
    expect(content).toMatch(/Difficulty: 4/);
  });
});
