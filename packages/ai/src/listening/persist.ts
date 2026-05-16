// Listening grade persistence — the bit between the deterministic grader
// and the database. Mirrors reading/persist.ts: lives in @elc/ai (not
// apps/web) so an integration test can drive it without a session
// cookie.
//
// Contract:
//   - Caller owns the OrgContext (the route handler / server action does
//     `await requireOrgContext()` before invoking this).
//   - Caller passes a `withOrg(ctx)`-wrapped Prisma client. Re-wrapping
//     here would double-inject the org filter; we don't.
//   - One transaction writes the Grade row, flips Attempt.status →
//     Graded, and backfills Answer.is_correct for every graded question.
//
// Idempotency: calling persistListeningGrade twice for the same attempt
// is a no-op the second time (we look up the attempt's existing Grade
// row first and return early if it's already graded).

import type { OrgContext } from "@elc/db";
import { Prisma, withOrg } from "@elc/db";
import {
  gradeListeningAttempt,
  type ListeningGrade,
  type ListeningGradeAnswer,
  type ListeningGradeQuestion,
} from "./grade";

export type ListeningPersistDb = ReturnType<typeof withOrg>;

export class ListeningPersistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListeningPersistError";
  }
}

export type PersistListeningGradeResult =
  | { ok: true; grade: ListeningGrade; alreadyGraded: false }
  | { ok: true; grade: null; alreadyGraded: true };

export async function persistListeningGrade(
  db: ListeningPersistDb,
  ctx: OrgContext,
  attemptId: string,
): Promise<PersistListeningGradeResult> {
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
          questions: {
            select: {
              id: true,
              type: true,
              prompt: true,
              position: true,
              points: true,
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
    throw new ListeningPersistError("Attempt not found.");
  }
  if (attempt.grade) {
    return { ok: true, grade: null, alreadyGraded: true };
  }

  const questions: ListeningGradeQuestion[] = attempt.test.questions.map(
    (q) => ({
      id: q.id,
      type: q.type,
      position: q.position,
      points: q.points,
      prompt: q.prompt,
      correctAnswerJson: q.correct_answer ?? null,
    }),
  );
  const answersForGrader: ListeningGradeAnswer[] = attempt.answers.map((a) => ({
    questionId: a.question_id,
    responseJson: a.response,
  }));

  const grade = gradeListeningAttempt({
    track: attempt.test.track,
    questions,
    answers: answersForGrader,
  });

  // Build per-Answer is_correct updates. A question with no saved Answer
  // row has nothing to update — the grader already counted it as incorrect
  // with reason "No answer submitted". For mcq-multi partial credit,
  // is_correct reflects the all-or-nothing view (true only on full
  // pick_count match); the granular points_earned lives on the breakdown.
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
