// Contract test for the Writing generation pipeline.
//
// Uses recorded fixture responses — no live network. Covers:
//   - Happy path per task_kind: model output → schema → validator → result.
//   - Retry on malformed JSON: first response junk, second valid.
//   - Schema rejection: both attempts malformed → GenerationShapeError.
//   - Validator rejection: schema OK but prompt missing a word target.
//   - task_kind / track mismatch against the request.
//   - resolveTrack guardrails for writing-task-2 and contradictory tracks.

import { describe, expect, it } from "vitest";
import type { OrgContext } from "@elc/db";
import {
  GenerationShapeError,
  GenerationValidationError,
} from "../errors";
import { createWritingGenerator } from "./writing";

const CTX: OrgContext = {
  org_id: "org_1",
  user_id: "super_1",
  role: "SuperAdmin",
};

const PROMPT_BODY = "FAKE WRITING GENERATION PROMPT";

const T1_ACADEMIC = {
  task_kind: "writing-task-1-academic" as const,
  track: "Academic" as const,
  difficulty: 4,
  prompt:
    "The bar chart below shows visitor numbers to three museums. " +
    "Summarise the information by selecting and reporting the main features, and make comparisons where relevant.\n\n" +
    "Write at least 150 words.",
  body_meta: { visual_kind: "bar" as const, topic: "museum visitors" },
  visual: {
    kind: "bar" as const,
    title: "Museum visitors",
    categories: ["A", "B", "C"],
    series: [
      { name: "2019", values: [10, 20, 30] },
      { name: "2023", values: [15, 25, 35] },
    ],
  },
};

const T1_GENERAL = {
  task_kind: "writing-task-1-general" as const,
  track: "GeneralTraining" as const,
  difficulty: 3,
  prompt:
    "You recently had a problem with a delivery.\n\n" +
    "Write a letter to the company. In your letter:\n\n" +
    "- explain what you ordered\n" +
    "- describe what went wrong\n" +
    "- say what you want them to do\n\n" +
    "Write at least 150 words.\n\nBegin your letter as follows:\n\nDear Sir or Madam,",
  body_meta: {
    register: "formal" as const,
    audience: "the company",
    scenario_topic: "delivery problem",
  },
};

const T2 = {
  task_kind: "writing-task-2" as const,
  track: "Academic" as const,
  difficulty: 5,
  prompt:
    "Some people believe remote work benefits society. " +
    "To what extent do you agree or disagree?\n\n" +
    "Give reasons for your answer and include any relevant examples from your own knowledge or experience.\n\n" +
    "Write at least 250 words.",
  body_meta: { question_subtype: "opinion" as const, topic: "remote work" },
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
      usage: { input_tokens: 900, output_tokens: 400 },
    };
  };
  return { chat, recorded, calls: () => i };
}

function loader(): string {
  return PROMPT_BODY;
}

describe("createWritingGenerator", () => {
  it("happy path → typed GeneratedWriting for Task 1 Academic", async () => {
    const ai = makeAi([{ text: JSON.stringify(T1_ACADEMIC) }]);
    const gen = createWritingGenerator({ ai, loadPrompt: loader });
    const result = await gen.generate({
      ctx: CTX,
      taskKind: "writing-task-1-academic",
      difficulty: 4,
    });
    expect(result.attempts).toBe(1);
    expect(result.value.task_kind).toBe("writing-task-1-academic");
    expect(result.value.track).toBe("Academic");
    expect(ai.recorded[0]?.system).toBe(PROMPT_BODY);
    expect(ai.recorded[0]?.messages[0]?.content).toMatch(
      /writing-task-1-academic/,
    );
  });

  it("happy path for Task 1 General", async () => {
    const ai = makeAi([{ text: JSON.stringify(T1_GENERAL) }]);
    const gen = createWritingGenerator({ ai, loadPrompt: loader });
    const result = await gen.generate({
      ctx: CTX,
      taskKind: "writing-task-1-general",
      difficulty: 3,
    });
    expect(result.value.task_kind).toBe("writing-task-1-general");
    expect(result.value.track).toBe("GeneralTraining");
  });

  it("happy path for Task 2 with an explicit track", async () => {
    const ai = makeAi([{ text: JSON.stringify(T2) }]);
    const gen = createWritingGenerator({ ai, loadPrompt: loader });
    const result = await gen.generate({
      ctx: CTX,
      taskKind: "writing-task-2",
      track: "Academic",
      difficulty: 5,
    });
    expect(result.value.task_kind).toBe("writing-task-2");
  });

  it("retries once on malformed JSON, then succeeds", async () => {
    const ai = makeAi([
      { text: "Here is the JSON: not actually json" },
      { text: JSON.stringify(T2) },
    ]);
    const gen = createWritingGenerator({ ai, loadPrompt: loader });
    const result = await gen.generate({
      ctx: CTX,
      taskKind: "writing-task-2",
      track: "Academic",
      difficulty: 5,
    });
    expect(result.attempts).toBe(2);
    expect(ai.calls()).toBe(2);
  });

  it("throws GenerationShapeError after the retry fails", async () => {
    const ai = makeAi([{ text: "nope" }, { text: "still nope" }]);
    const gen = createWritingGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({
        ctx: CTX,
        taskKind: "writing-task-2",
        track: "Academic",
        difficulty: 5,
      }),
    ).rejects.toBeInstanceOf(GenerationShapeError);
  });

  it("throws GenerationValidationError when the prompt is missing its word target", async () => {
    const broken = {
      ...T2,
      prompt:
        "Some people believe remote work benefits society. " +
        "To what extent do you agree or disagree?\n\n" +
        "Give reasons for your answer and include any relevant examples.",
    };
    const ai = makeAi([{ text: JSON.stringify(broken) }]);
    const gen = createWritingGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({
        ctx: CTX,
        taskKind: "writing-task-2",
        track: "Academic",
        difficulty: 5,
      }),
    ).rejects.toBeInstanceOf(GenerationValidationError);
  });

  it("rejects a task_kind mismatch (model returned T2 when T1 was requested)", async () => {
    const ai = makeAi([{ text: JSON.stringify(T2) }]);
    const gen = createWritingGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({
        ctx: CTX,
        taskKind: "writing-task-1-general",
        difficulty: 3,
      }),
    ).rejects.toBeInstanceOf(GenerationValidationError);
  });

  it("rejects a track mismatch for Task 2", async () => {
    const ai = makeAi([
      { text: JSON.stringify({ ...T2, track: "GeneralTraining" }) },
    ]);
    const gen = createWritingGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({
        ctx: CTX,
        taskKind: "writing-task-2",
        track: "Academic",
        difficulty: 5,
      }),
    ).rejects.toBeInstanceOf(GenerationValidationError);
  });

  it("throws when Task 2 is requested without an explicit track", async () => {
    const ai = makeAi([{ text: JSON.stringify(T2) }]);
    const gen = createWritingGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({ ctx: CTX, taskKind: "writing-task-2", difficulty: 5 }),
    ).rejects.toThrow(/explicit track/);
  });

  it("throws when the caller's track contradicts a Task 1 kind", async () => {
    const ai = makeAi([{ text: JSON.stringify(T1_ACADEMIC) }]);
    const gen = createWritingGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({
        ctx: CTX,
        taskKind: "writing-task-1-academic",
        track: "GeneralTraining",
        difficulty: 4,
      }),
    ).rejects.toThrow(/Academic-only/);
  });

  it("includes the topic hint in the user turn when provided", async () => {
    const ai = makeAi([{ text: JSON.stringify(T2) }]);
    const gen = createWritingGenerator({ ai, loadPrompt: loader });
    await gen.generate({
      ctx: CTX,
      taskKind: "writing-task-2",
      track: "Academic",
      difficulty: 5,
      topicHint: "the future of public libraries",
    });
    expect(ai.recorded[0]?.messages[0]?.content).toMatch(
      /public libraries/,
    );
  });
});
