// Persistence for generated Writing content.
//
// The output of `writingGenerator.generate()` is a typed
// `GeneratedWriting`. This module is the bit between the validator and
// the database: write the task framing to `Test.body_json`, the task
// prompt to a single `Question` row, and (for Task 1 Academic) the
// chart spec to `Question.visual`. `Test.status` starts as
// PendingReview; SuperAdmin moderation promotes it to Approved.
//
// Unlike Reading, a Writing test has exactly ONE question — the task
// itself — and it carries no `correct_answer`: Writing is AI-graded
// against a rubric, not auto-scored against a key.
//
// Tests inject a `db` mock; production passes the raw PrismaClient
// because Test/Question are global models — `withOrg()` would not scope
// them anyway.

import { Prisma } from "@elc/db";
import type { prisma } from "@elc/db/client";
import type { GeneratedWriting } from "./writing-schema";

// Structural slice of the production PrismaClient. Tests pass a tiny
// mock; production wires `prisma` from @elc/db/client directly.
export type PersistGeneratedWritingDb = Pick<typeof prisma, "test" | "question">;

export type PersistWritingResult = {
  testId: string;
  questionId: string;
};

// The body_json shape stored on the Test row. The canonical task text
// lives on Question.prompt; this is the structured metadata around it
// (task_kind + the per-kind body_meta the generator produced).
function buildBodyJson(value: GeneratedWriting): Prisma.InputJsonValue {
  return {
    task_kind: value.task_kind,
    body_meta: value.body_meta,
  } as unknown as Prisma.InputJsonValue;
}

export async function persistGeneratedWriting(
  db: PersistGeneratedWritingDb,
  value: GeneratedWriting,
  opts: {
    // The SuperAdmin who initiated the generation. Logged to
    // ActivityLog at the route layer, not here — kept on the input
    // shape so the signature is stable when that wiring lands.
    generatedById: string;
    // Optional override of the difficulty stored on the Test row. The
    // schema also carries `difficulty`, but the caller may want to clamp.
    difficulty?: number;
    // The model that generated this content (gateway ChatResponse.model).
    // Stored on Test.generated_model so moderation can see provenance.
    generatedModel?: string;
  },
): Promise<PersistWritingResult> {
  void opts.generatedById; // logged at the route layer, not here

  const test = await db.test.create({
    data: {
      track: value.track,
      section: "Writing",
      difficulty: opts.difficulty ?? value.difficulty,
      // PendingReview rows have no approver until moderation promotes them.
      status: "PendingReview",
      body_json: buildBodyJson(value),
      generated_model: opts.generatedModel ?? null,
    },
    select: { id: true },
  });

  // Task 1 Academic carries a chart spec; the other two kinds don't use
  // the visual column at all.
  const visual =
    value.task_kind === "writing-task-1-academic"
      ? (value.visual as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull;

  const question = await db.question.create({
    data: {
      test_id: test.id,
      type: value.task_kind,
      prompt: value.prompt,
      position: 0,
      // Writing is rubric-graded, not auto-scored — no answer key.
      correct_answer: Prisma.JsonNull,
      visual,
    },
    select: { id: true },
  });

  return { testId: test.id, questionId: question.id };
}
