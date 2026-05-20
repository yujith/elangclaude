// Unit test for persistGeneratedReading using a structural db mock - no
// real database. Verifies the Test/Question row shapes and, importantly,
// that optional passage fields are omitted instead of persisted as
// `undefined` inside Prisma JSON.

import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@elc/db";
import { persistGeneratedReading } from "./persist";
import type { GeneratedReading } from "./schema";

function makeDb() {
  let nextId = 0;
  const test = {
    create: vi.fn(async (_args: unknown) => ({ id: "test_1" })),
  };
  const question = {
    create: vi.fn(async (_args: unknown) => ({ id: `question_${++nextId}` })),
  };
  return { db: { test, question } as never, test, question };
}

const READING: GeneratedReading = {
  track: "Academic",
  difficulty: 5,
  passage: {
    title: "A passage title",
    paragraphs: [
      { label: "A", text: "A".repeat(120) },
      { label: "B", text: "B".repeat(120) },
      { label: "C", text: "C".repeat(120) },
      { label: "D", text: "D".repeat(120) },
      { label: "E", text: "E".repeat(120) },
    ],
  },
  questions: [
    {
      type: "reading-mcq",
      position: 0,
      prompt: "Pick the answer.",
      correct_answer: {
        options: [
          { id: "A", text: "One" },
          { id: "B", text: "Two" },
        ],
        correct: "A",
      },
    },
    {
      type: "reading-short-answer",
      position: 1,
      prompt: "Which word is accepted?",
      correct_answer: { word_limit: 1, accepted: ["One"] },
    },
  ],
};

describe("persistGeneratedReading", () => {
  it("writes a PendingReview Reading Test with passage body_json", async () => {
    const { db, test } = makeDb();
    await persistGeneratedReading(db, READING, { generatedById: "super_1" });
    const arg = test.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.section).toBe("Reading");
    expect(arg.data.status).toBe("PendingReview");
    expect(arg.data.track).toBe("Academic");
    expect(arg.data.difficulty).toBe(5);
    expect(arg.data.body_json).toMatchObject({
      title: "A passage title",
      paragraphs: READING.passage.paragraphs,
    });
  });

  it("omits optional passage title instead of writing undefined into JSON", async () => {
    const { db, test } = makeDb();
    const withoutTitle: GeneratedReading = {
      ...READING,
      passage: {
        paragraphs: READING.passage.paragraphs,
      },
    };
    await persistGeneratedReading(db, withoutTitle, {
      generatedById: "super_1",
    });
    const body = (
      test.create.mock.calls[0]![0] as { data: { body_json: unknown } }
    ).data.body_json as Record<string, unknown>;
    expect(body).not.toHaveProperty("title");
    expect(Object.values(body)).not.toContain(undefined);
  });

  it("creates one Question row per generated question", async () => {
    const { db, question } = makeDb();
    const result = await persistGeneratedReading(db, READING, {
      generatedById: "super_1",
    });
    expect(question.create).toHaveBeenCalledTimes(READING.questions.length);
    expect(result.questionIds).toEqual(["question_1", "question_2"]);
    const first = question.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(first.data.type).toBe("reading-mcq");
    expect(first.data.correct_answer).toEqual(
      READING.questions[0]!.correct_answer,
    );
    expect(first.data.visual).toBe(Prisma.JsonNull);
  });

  it("honours a difficulty override on the Test row", async () => {
    const { db, test } = makeDb();
    await persistGeneratedReading(db, READING, {
      generatedById: "super_1",
      difficulty: 2,
    });
    const arg = test.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.difficulty).toBe(2);
  });
});
