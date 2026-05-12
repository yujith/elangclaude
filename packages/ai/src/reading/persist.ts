// Reading grade persistence — the bit between the deterministic grader and
// the database. Lives here (not in apps/web) so an integration test can
// drive it without a session cookie.
//
// Contract:
//   - Caller owns the OrgContext (the route handler / server action does
//     `await requireOrgContext()` before invoking this).
//   - Caller passes a `withOrg(ctx)`-wrapped Prisma client. Re-wrapping
//     inside this module would double-inject the org filter; we don't.
//   - One transaction writes the Grade row, flips Attempt.status → Graded,
//     and backfills Answer.is_correct for every graded question.
//
// Idempotency: calling persistReadingGrade twice for the same attempt is
// a no-op the second time (we look up the attempt's existing Grade row
// first and return early if it's already graded).

import type { OrgContext } from "@elc/db";
import { Prisma, withOrg } from "@elc/db";
import {
  gradeReadingAttempt,
  type ReadingGrade,
  type ReadingGradeAnswer,
  type ReadingGradeQuestion,
} from "./grade";
import { parseReadingPassage } from "./passage";

// We accept whatever `withOrg(ctx)` returns — a Prisma extended client.
// Spelling out the slice in structural form fights Prisma's complex
// generics; reusing the actual return type keeps the call sites trivial
// and lets typecheck cover the select shapes we use below.
export type ReadingPersistDb = ReturnType<typeof withOrg>;

export class ReadingPersistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadingPersistError";
  }
}

export type PersistResult =
  | { ok: true; grade: ReadingGrade; alreadyGraded: false }
  | { ok: true; grade: null; alreadyGraded: true };

export async function persistReadingGrade(
  db: ReadingPersistDb,
  ctx: OrgContext,
  attemptId: string,
): Promise<PersistResult> {
  // Single read pulls everything the grader needs. The org filter is
  // already applied by the withOrg-wrapped client; we add the user_id
  // check below as a second layer (two learners in the same org should
  // not be able to grade each other's attempts).
  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      user_id: true,
      grade: { select: { id: true } },
      test: {
        select: {
          track: true,
          body_json: true,
          questions: {
            select: {
              id: true,
              type: true,
              prompt: true,
              position: true,
              correct_answer: true,
            },
            orderBy: { position: "asc" },
          },
        },
      },
      answers: {
        select: { id: true, question_id: true, response: true },
      },
    },
  });
  if (!attempt || attempt.user_id !== ctx.user_id) {
    throw new ReadingPersistError("Attempt not found.");
  }
  if (attempt.grade) {
    return { ok: true, grade: null, alreadyGraded: true };
  }

  const questions: ReadingGradeQuestion[] = attempt.test.questions.map((q) => ({
    id: q.id,
    type: q.type,
    position: q.position,
    prompt: q.prompt,
    correctAnswerJson: q.correct_answer ?? null,
  }));
  const answersForGrader: ReadingGradeAnswer[] = attempt.answers.map((a) => ({
    questionId: a.question_id,
    responseJson: a.response,
  }));

  const passage = parseReadingPassage(attempt.test.body_json);
  const grade = gradeReadingAttempt({
    track: attempt.test.track,
    questions,
    answers: answersForGrader,
    passageContext: passage
      ? {
          paragraphLabels: passage.paragraphs.map((p) => p.label),
          matchingGroups: passage.matching_groups,
        }
      : undefined,
  });

  // Build the per-Answer is_correct updates we need. A question with no
  // saved Answer row has nothing to update — the grader already counted
  // it as incorrect with reason "No answer submitted".
  const answerById = new Map<string, { id: string }>();
  for (const a of attempt.answers) {
    answerById.set(a.question_id, { id: a.id });
  }
  const correctnessByQ = new Map<string, boolean>();
  for (const item of grade.breakdown) {
    correctnessByQ.set(item.question_id, item.is_correct);
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [
    db.grade.create({
      data: {
        org_id: ctx.org_id,
        attempt_id: attempt.id,
        band_overall: new Prisma.Decimal(grade.band_overall),
        criteria_scores_json: grade as unknown as Prisma.InputJsonValue,
        feedback_text: null,
        graded_by: "AI",
      },
    }),
    db.attempt.update({
      where: { id: attempt.id },
      data: { status: "Graded" },
    }),
  ];
  for (const [questionId, isCorrect] of correctnessByQ) {
    const row = answerById.get(questionId);
    if (!row) continue;
    ops.push(
      db.answer.update({
        where: { id: row.id },
        data: { is_correct: isCorrect },
      }),
    );
  }

  await db.$transaction(ops);
  return { ok: true, grade, alreadyGraded: false };
}
