// Contract test for the Reading generation pipeline.
//
// Uses a recorded fixture response — no live network. Covers:
//   - Happy path: model output → schema OK → validator OK → typed result.
//   - Retry on malformed JSON: first response is junk, second is valid.
//   - Schema rejection: both attempts malformed → GenerationShapeError.
//   - Validator retry: schema OK but content out of contract → repair call.
//   - Validator rejection after retry budget →
//     GenerationValidationError.
//   - Track-mismatch: model swapped the track → repair call.

import { describe, expect, it } from "vitest";
import type { OrgContext } from "@elc/db";
import {
  GenerationShapeError,
  GenerationValidationError,
} from "../errors";
import { createReadingGenerator } from "./reading";
import type { GeneratedReading } from "./schema";

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

const VALID_GENERATION: GeneratedReading = {
  track: "Academic" as const,
  difficulty: 5,
  passage: {
    title: "A short history of paper",
    paragraphs: [
      { label: "A", text: repeatToWordCount(90) },
      { label: "B", text: repeatToWordCount(90) },
      { label: "C", text: repeatToWordCount(90) },
      { label: "D", text: repeatToWordCount(90) },
      { label: "E", text: repeatToWordCount(90) },
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
    {
      type: "reading-yes-no-not-given" as const,
      position: 4,
      prompt: "The author prefers bark over wood.\n\nYes / No / Not Given",
      correct_answer: { correct: "not given" as const },
    },
    {
      type: "reading-short-answer" as const,
      position: 5,
      prompt: "What could not keep pace with demand from printing?",
      correct_answer: {
        word_limit: 4,
        accepted: ["the supply of rags"],
      },
    },
  ],
};

function cloneGeneration(
  value: GeneratedReading = VALID_GENERATION,
): GeneratedReading {
  return JSON.parse(JSON.stringify(value)) as GeneratedReading;
}

function validGenerationForTrack(
  track: "Academic" | "GeneralTraining",
): GeneratedReading {
  const value = cloneGeneration();
  value.track = track;
  if (track === "GeneralTraining") {
    value.passage.gt_context = "general-reading";
  } else {
    delete value.passage.gt_context;
  }
  return value;
}

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
      model: "google/gemini-2.5-flash",
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
    expect(result.value.questions).toHaveLength(6);
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

  it("throws GenerationShapeError after the retry budget fails", async () => {
    const ai = makeAi([
      { text: "nope" },
      { text: "still nope" },
      { text: "once more nope" },
    ]);
    const gen = createReadingGenerator({ ai, loadPrompt: loader });
    await expect(
      gen.generate({ ctx: CTX, track: "Academic", difficulty: 5 }),
    ).rejects.toBeInstanceOf(GenerationShapeError);
    expect(ai.calls()).toBe(3);
  });

  it("retries when validation fails, then returns the corrected generation", async () => {
    const broken = {
      ...cloneGeneration(),
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
        VALID_GENERATION.questions[4]!,
        VALID_GENERATION.questions[5]!,
      ],
    };
    const ai = makeAi([
      { text: JSON.stringify(broken) },
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
    expect(ai.recorded[1]?.messages.at(-1)?.content).toMatch(
      /completion\.answer-not-in-passage/,
    );
  });

  it("throws GenerationValidationError after the validation retry budget fails", async () => {
    // Each paragraph passes the schema's min character length (80) but the
    // combined word count is well under the Academic 600-word minimum.
    const minLengthFiller =
      "This single paragraph is just long enough to satisfy the strict schema minimum length of eighty characters, but the cumulative word count across the three short paragraphs is well under the Academic six-hundred-word floor enforced by the content validator. ";
    const tooShort = {
      ...cloneGeneration(),
      passage: {
        title: "Too short",
        paragraphs: [
          { label: "A", text: minLengthFiller },
          { label: "B", text: minLengthFiller },
          { label: "C", text: minLengthFiller },
          { label: "D", text: minLengthFiller },
          { label: "E", text: minLengthFiller },
        ],
      },
    };
    const ai = makeAi([
      { text: JSON.stringify(tooShort) },
      { text: JSON.stringify(tooShort) },
      { text: JSON.stringify(tooShort) },
    ]);
    const gen = createReadingGenerator({ ai, loadPrompt: loader });
    await expect(async () => {
      try {
        await gen.generate({ ctx: CTX, track: "Academic", difficulty: 5 });
      } catch (err) {
        expect(err).toBeInstanceOf(GenerationValidationError);
        expect((err as GenerationValidationError).issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: "passage.too-short" }),
          ]),
        );
        throw err;
      }
    }).rejects.toBeInstanceOf(GenerationValidationError);
    expect(ai.calls()).toBe(3);
  });

  it("retries a track mismatch", async () => {
    const swapped = {
      ...cloneGeneration(),
      track: "GeneralTraining" as const,
      passage: {
        ...VALID_GENERATION.passage,
        gt_context: "general-reading" as const,
      },
    };
    const ai = makeAi([
      { text: JSON.stringify(swapped) },
      { text: JSON.stringify(VALID_GENERATION) },
    ]);
    const gen = createReadingGenerator({ ai, loadPrompt: loader });
    const result = await gen.generate({
      ctx: CTX,
      track: "Academic",
      difficulty: 5,
    });
    expect(result.attempts).toBe(2);
    expect(ai.recorded[1]?.messages.at(-1)?.content).toMatch(/track\.mismatch/);
  });

  it("retries every Reading validation issue code before surfacing an error", async () => {
    type Case = {
      code: string;
      track?: "Academic" | "GeneralTraining";
      mutate: (value: GeneratedReading) => void;
    };
    const minLengthFiller =
      "This paragraph is long enough to satisfy the schema minimum length, but it is intentionally too brief for the full Reading passage word-count validator. ";
    const cases: Case[] = [
      {
        code: "passage.too-short",
        mutate: (value) => {
          value.passage.paragraphs = value.passage.paragraphs.map((p) => ({
            ...p,
            text: minLengthFiller,
          }));
        },
      },
      {
        code: "passage.too-long",
        mutate: (value) => {
          value.passage.paragraphs = value.passage.paragraphs.map((p) => ({
            ...p,
            text: repeatToWordCount(210),
          }));
        },
      },
      {
        code: "passage.missing-gt-context",
        track: "GeneralTraining",
        mutate: (value) => {
          delete value.passage.gt_context;
        },
      },
      {
        code: "passage.too-few-paragraphs",
        mutate: (value) => {
          value.passage.paragraphs = value.passage.paragraphs
            .slice(0, 4)
            .map((p) => ({ ...p, text: repeatToWordCount(150) }));
        },
      },
      {
        code: "passage.too-many-paragraphs",
        mutate: (value) => {
          value.passage.paragraphs = Array.from({ length: 8 }, (_, i) => ({
            label: String.fromCharCode("A".charCodeAt(0) + i),
            text: repeatToWordCount(60),
          }));
        },
      },
      {
        code: "passage.invalid-paragraph-labels",
        mutate: (value) => {
          value.passage.paragraphs[2]!.label = "F";
        },
      },
      {
        code: "questions.too-few",
        mutate: (value) => {
          value.questions = value.questions.slice(0, 5);
        },
      },
      {
        code: "questions.too-many",
        mutate: (value) => {
          value.questions = Array.from({ length: 11 }, (_, i) => ({
            ...value.questions[i % value.questions.length]!,
            position: i,
            prompt: `Question ${i}`,
          }));
        },
      },
      {
        code: "questions.non-contiguous-positions",
        mutate: (value) => {
          value.questions[5]!.position = 7;
        },
      },
      {
        code: "completion.answer-not-in-passage",
        mutate: (value) => {
          const q = value.questions.find(
            (candidate) => candidate.type === "reading-sentence-completion",
          );
          if (q?.type === "reading-sentence-completion") {
            q.correct_answer.accepted = ["unobtainium"];
          }
        },
      },
      {
        code: "short-answer.answer-not-in-passage",
        mutate: (value) => {
          const q = value.questions.find(
            (candidate) => candidate.type === "reading-short-answer",
          );
          if (q?.type === "reading-short-answer") {
            q.correct_answer.accepted = ["unobtainium"];
          }
        },
      },
      {
        code: "mcq.correct-not-grounded",
        mutate: (value) => {
          const q = value.questions.find(
            (candidate) => candidate.type === "reading-mcq",
          );
          if (q?.type === "reading-mcq") {
            q.correct_answer.options[0]!.text = "unrelated phantasm";
          }
        },
      },
      {
        code: "track.mismatch",
        mutate: (value) => {
          value.track = "GeneralTraining";
          value.passage.gt_context = "general-reading";
        },
      },
    ];

    for (const c of cases) {
      const track = c.track ?? "Academic";
      const broken = validGenerationForTrack(track);
      c.mutate(broken);
      const ai = makeAi([
        { text: JSON.stringify(broken) },
        { text: JSON.stringify(validGenerationForTrack(track)) },
      ]);
      const gen = createReadingGenerator({ ai, loadPrompt: loader });
      const result = await gen.generate({
        ctx: CTX,
        track,
        difficulty: 5,
      });
      expect(result.attempts, c.code).toBe(2);
      expect(ai.recorded[1]?.messages.at(-1)?.content, c.code).toContain(
        c.code,
      );
    }
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
