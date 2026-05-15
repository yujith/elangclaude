// Unit test for persistGeneratedSpeaking using a structural db mock — no
// real database. Verifies the Test/Question row shapes: PendingReview
// status, the 3-part script on Test.body_json, exactly 3 thin Question
// anchors with the right types/positions and no answer key or visual.

import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@elc/db";
import { persistGeneratedSpeaking } from "./speaking-persist";
import type { GeneratedSpeaking } from "./speaking-schema";

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

const SPEAKING: GeneratedSpeaking = {
  section: "speaking",
  track: "GeneralTraining",
  difficulty: 4,
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
        topic: "Reading",
        questions: [
          "Do you enjoy reading?",
          "What kind of books do you like?",
          "When do you usually read?",
        ],
      },
      {
        topic: "Free time",
        questions: [
          "What do you do in your free time?",
          "Do you prefer relaxing alone or with others?",
          "Has that changed over the years?",
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
    followup_questions: ["Did you recommend it to anyone?"],
  },
  part3: {
    theme: "Reading and society",
    questions: [
      "Why have reading habits changed in recent years?",
      "How important is it for children to read for pleasure?",
      "Will printed books disappear in the future?",
      "What role should libraries play in a community?",
    ],
  },
};

describe("persistGeneratedSpeaking", () => {
  it("writes a PendingReview Speaking Test with the 3-part script in body_json", async () => {
    const { db, test } = makeDb();
    await persistGeneratedSpeaking(db, SPEAKING, { generatedById: "super_1" });
    const arg = test.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.section).toBe("Speaking");
    expect(arg.data.status).toBe("PendingReview");
    expect(arg.data.track).toBe("GeneralTraining");
    expect(arg.data.difficulty).toBe(4);
    expect(arg.data.body_json).toMatchObject({
      topic_domain: "books and reading",
      part2: { cue_card_topic: "Describe a book you recently read and enjoyed." },
    });
  });

  it("creates exactly 3 Question anchors with the right types and positions", async () => {
    const { db, question } = makeDb();
    const result = await persistGeneratedSpeaking(db, SPEAKING, {
      generatedById: "super_1",
    });
    expect(question.create).toHaveBeenCalledTimes(3);
    const types = question.create.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data.type,
    );
    const positions = question.create.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data.position,
    );
    expect(types).toEqual([
      "speaking-part-1",
      "speaking-part-2-cue",
      "speaking-part-3",
    ]);
    expect(positions).toEqual([0, 1, 2]);
    expect(result.questionIds).toHaveLength(3);
  });

  it("gives each Question a readable label and no answer key or visual", async () => {
    const { db, question } = makeDb();
    await persistGeneratedSpeaking(db, SPEAKING, { generatedById: "super_1" });
    for (const call of question.create.mock.calls) {
      const data = (call[0] as { data: Record<string, unknown> }).data;
      expect(data.correct_answer).toBe(Prisma.JsonNull);
      expect(data.visual).toBe(Prisma.JsonNull);
      expect(typeof data.prompt).toBe("string");
      expect((data.prompt as string).length).toBeGreaterThan(0);
    }
    const part2Prompt = (
      question.create.mock.calls[1]![0] as {
        data: Record<string, unknown>;
      }
    ).data.prompt;
    expect(part2Prompt).toContain("Describe a book you recently read");
  });

  it("honours a difficulty override on the Test row", async () => {
    const { db, test } = makeDb();
    await persistGeneratedSpeaking(db, SPEAKING, {
      generatedById: "super_1",
      difficulty: 2,
    });
    const arg = test.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.difficulty).toBe(2);
  });
});
