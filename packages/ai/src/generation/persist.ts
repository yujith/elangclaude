// Persistence for generated Reading content.
//
// The output of `readingGenerator.generate()` is a typed `GeneratedReading`.
// This module is the bit between the validator and the database: write
// the passage to `Test.body_json` and the questions to per-row `Question`
// records, with `Test.status = PendingReview`. SuperAdmin moderation
// (Phase 6) promotes PendingReview → Approved.
//
// Tests inject a `db` mock; production passes the raw PrismaClient
// because Test/Question are global models — `withOrg()` would not scope
// them anyway.

import { Prisma } from "@elc/db";
import type { prisma } from "@elc/db/client";
import type { GeneratedReading } from "./schema";

// Structural slice of the production PrismaClient. Tests pass a tiny
// mock; production wires `prisma` from @elc/db/client directly.
export type PersistGeneratedDb = Pick<typeof prisma, "test" | "question">;

export type PersistResult = {
  testId: string;
  questionIds: string[];
};

function questionPayloadToJson(
  q: GeneratedReading["questions"][number],
): Prisma.InputJsonValue {
  return q.correct_answer as unknown as Prisma.InputJsonValue;
}

export async function persistGeneratedReading(
  db: PersistGeneratedDb,
  value: GeneratedReading,
  opts: {
    // The SuperAdmin who initiated the generation. Currently unused on
    // Test.approved_by — that column reflects the moderator who flips the
    // row to Approved later, which may or may not be the same person.
    // Kept on the input shape so Phase 6+ can log the generator id to
    // ActivityLog without changing this signature.
    generatedById: string;
    // Optional override of the difficulty stored on the Test row. The
    // schema also carries `difficulty`, but the caller may want to clamp
    // (the model occasionally returns the wrong number).
    difficulty?: number;
  },
): Promise<PersistResult> {
  void opts.generatedById; // currently logged at the route layer, not here
  const test = await db.test.create({
    data: {
      track: value.track,
      section: "Reading",
      difficulty: opts.difficulty ?? value.difficulty,
      // PendingReview rows have no approver until Phase 6 promotes them.
      status: "PendingReview",
      body_json: {
        title: value.passage.title,
        paragraphs: value.passage.paragraphs,
        // gt_context only meaningful on GT outputs; we still pass it
        // through on Academic outputs if the model bothered to set it,
        // since the picker ignores it for Academic anyway.
        ...(value.passage.gt_context
          ? { gt_context: value.passage.gt_context }
          : {}),
      } as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  const questionIds: string[] = [];
  for (const q of value.questions) {
    const created = await db.question.create({
      data: {
        test_id: test.id,
        type: q.type,
        prompt: q.prompt,
        position: q.position,
        correct_answer: questionPayloadToJson(q),
        // Reading questions don't use the visual column today.
        visual: Prisma.JsonNull,
      },
      select: { id: true },
    });
    questionIds.push(created.id);
  }

  return { testId: test.id, questionIds };
}
