// Unit test for persistGeneratedWriting using a structural db mock — no
// real database. Verifies the Test/Question row shapes: PendingReview
// status, single question, visual present only for Task 1 Academic,
// never an answer key.

import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@elc/db";
import { persistGeneratedWriting } from "./writing-persist";
import type { GeneratedWriting } from "./writing-schema";

function makeDb() {
  const test = {
    create: vi.fn(async (_args: unknown) => ({ id: "test_1" })),
  };
  const question = {
    create: vi.fn(async (_args: unknown) => ({ id: "question_1" })),
  };
  // The structural slice persistGeneratedWriting depends on.
  return {
    db: { test, question } as never,
    test,
    question,
  };
}

const T1_ACADEMIC: GeneratedWriting = {
  task_kind: "writing-task-1-academic",
  track: "Academic",
  difficulty: 4,
  prompt:
    "The bar chart below shows visitor numbers. " +
    "Summarise the information by selecting and reporting the main features, and make comparisons where relevant.\n\n" +
    "Write at least 150 words.",
  body_meta: { visual_kind: "bar", topic: "museum visitors" },
  visual: {
    kind: "bar",
    categories: ["A", "B"],
    series: [{ name: "2019", values: [1, 2] }],
  },
};

const T2: GeneratedWriting = {
  task_kind: "writing-task-2",
  track: "GeneralTraining",
  difficulty: 5,
  prompt:
    "Some people believe X. To what extent do you agree or disagree?\n\n" +
    "Give reasons for your answer and include any relevant examples.\n\n" +
    "Write at least 250 words.",
  body_meta: { question_subtype: "opinion", topic: "x" },
};

describe("persistGeneratedWriting", () => {
  it("writes a PendingReview Writing Test with task_kind in body_json", async () => {
    const { db, test } = makeDb();
    await persistGeneratedWriting(db, T1_ACADEMIC, {
      generatedById: "super_1",
    });
    const arg = test.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.section).toBe("Writing");
    expect(arg.data.status).toBe("PendingReview");
    expect(arg.data.track).toBe("Academic");
    expect(arg.data.body_json).toMatchObject({
      task_kind: "writing-task-1-academic",
    });
  });

  it("writes exactly one Question with the task prompt and no answer key", async () => {
    const { db, question } = makeDb();
    const result = await persistGeneratedWriting(db, T2, {
      generatedById: "super_1",
    });
    expect(question.create).toHaveBeenCalledOnce();
    const arg = question.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.type).toBe("writing-task-2");
    expect(arg.data.prompt).toBe(T2.prompt);
    expect(arg.data.position).toBe(0);
    expect(arg.data.correct_answer).toBe(Prisma.JsonNull);
    expect(result.questionId).toBe("question_1");
  });

  it("persists the visual spec for Task 1 Academic", async () => {
    const { db, question } = makeDb();
    await persistGeneratedWriting(db, T1_ACADEMIC, {
      generatedById: "super_1",
    });
    const arg = question.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.visual).toMatchObject({ kind: "bar" });
  });

  it("leaves the visual column null for non-Academic-T1 kinds", async () => {
    const { db, question } = makeDb();
    await persistGeneratedWriting(db, T2, { generatedById: "super_1" });
    const arg = question.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.visual).toBe(Prisma.JsonNull);
  });

  it("honours a difficulty override on the Test row", async () => {
    const { db, test } = makeDb();
    await persistGeneratedWriting(db, T2, {
      generatedById: "super_1",
      difficulty: 2,
    });
    const arg = test.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.difficulty).toBe(2);
  });
});
