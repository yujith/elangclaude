// Unit test for persistGeneratedListening using a structural db mock — no
// real database. Verifies the Test/Question row shapes, the
// schema_version stamp on body_json, and that the persisted body_json
// round-trips through the runtime parser without errors.

import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@elc/db";
import { parseListeningContent } from "../listening/content";
import { persistGeneratedListening } from "./listening-persist";
import { validatorCleanGeneration } from "./listening-test-fixtures";

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

describe("persistGeneratedListening", () => {
  it("writes a PendingReview Listening Test with the 4-part script in body_json", async () => {
    const { db, test } = makeDb();
    await persistGeneratedListening(db, validatorCleanGeneration(), {
      generatedById: "super_1",
    });
    const arg = test.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.section).toBe("Listening");
    expect(arg.data.status).toBe("PendingReview");
    expect(arg.data.track).toBe("Academic");
    expect(arg.data.difficulty).toBe(3);
    expect(arg.data.body_json).toMatchObject({
      schema_version: 1,
    });
  });

  it("persists a body_json that the runtime parser accepts", async () => {
    const { db, test } = makeDb();
    await persistGeneratedListening(db, validatorCleanGeneration(), {
      generatedById: "super_1",
    });
    const body = (
      test.create.mock.calls[0]![0] as { data: { body_json: unknown } }
    ).data.body_json;
    const parsed = parseListeningContent(body);
    expect(parsed).not.toBeNull();
    expect(parsed?.parts).toHaveLength(4);
  });

  it("creates one Question row per generated question, with positions preserved", async () => {
    const { db, question } = makeDb();
    const gen = validatorCleanGeneration();
    await persistGeneratedListening(db, gen, { generatedById: "super_1" });
    expect(question.create).toHaveBeenCalledTimes(gen.questions.length);
    const positions = question.create.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data.position,
    );
    expect(positions).toEqual(gen.questions.map((q) => q.position));
  });

  it("writes the per-question correct_answer JSON and a non-null points value", async () => {
    const { db, question } = makeDb();
    const gen = validatorCleanGeneration();
    await persistGeneratedListening(db, gen, { generatedById: "super_1" });
    for (let i = 0; i < gen.questions.length; i++) {
      const call = question.create.mock.calls[i]!;
      const data = (call[0] as { data: Record<string, unknown> }).data;
      expect(data.type).toBe(gen.questions[i]!.type);
      expect(data.correct_answer).toEqual(gen.questions[i]!.correct_answer);
      expect(data.points).toBe(gen.questions[i]!.points);
      // Listening never uses the visual column.
      expect(data.visual).toBe(Prisma.JsonNull);
    }
  });

  it("honours a difficulty override on the Test row", async () => {
    const { db, test } = makeDb();
    await persistGeneratedListening(db, validatorCleanGeneration(), {
      generatedById: "super_1",
      difficulty: 5,
    });
    const arg = test.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.difficulty).toBe(5);
  });

  it("uses points=2 for the mcq-multi question (matches its pick_count)", async () => {
    const { db, question } = makeDb();
    const gen = validatorCleanGeneration();
    await persistGeneratedListening(db, gen, { generatedById: "super_1" });
    const multiIndex = gen.questions.findIndex(
      (q) => q.type === "listening-mcq-multi",
    );
    expect(multiIndex).toBeGreaterThanOrEqual(0);
    const call = question.create.mock.calls[multiIndex]!;
    expect((call[0] as { data: Record<string, unknown> }).data.points).toBe(2);
  });
});
