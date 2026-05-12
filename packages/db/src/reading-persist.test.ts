// Integration test for the Reading grading persistence path.
//
// Runs against the Neon test branch (DATABASE_URL_TEST, forced in
// test-setup.ts). The unit tests in @elc/ai/src/reading/grade.test.ts
// already cover gradeReadingAttempt's pure logic — this test covers the
// DB plumbing: the Grade row is created, per-Answer is_correct is
// backfilled, the Attempt flips to Graded, and idempotency works.

import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { persistReadingGrade, type ReadingGrade } from "@elc/ai";
import { prisma } from "./client";
import { withOrg } from "./tenancy";
import { createTestOrg, ctxFor, resetDatabase } from "./test-helpers";

beforeEach(async () => {
  await resetDatabase();
});

async function seedReadingTest() {
  // Global content: an Approved Reading test with three mixed-type questions.
  const test = await prisma.test.create({
    data: {
      track: "Academic",
      section: "Reading",
      difficulty: 5,
      status: "Approved",
      body_json: {
        title: "Stub passage",
        paragraphs: [
          { label: "A", text: "Stub paragraph one." },
          { label: "B", text: "Stub paragraph two." },
        ],
      } satisfies Prisma.InputJsonValue,
    },
  });
  await prisma.question.create({
    data: {
      id: `${test.id}-q-mcq`,
      test_id: test.id,
      type: "reading-mcq",
      prompt: "Pick the second option.",
      position: 0,
      correct_answer: {
        options: [
          { id: "A", text: "Wrong" },
          { id: "B", text: "Right" },
        ],
        correct: "B",
      } satisfies Prisma.InputJsonValue,
    },
  });
  await prisma.question.create({
    data: {
      id: `${test.id}-q-tfng`,
      test_id: test.id,
      type: "reading-true-false-not-given",
      prompt: "Pick Not Given.",
      position: 1,
      correct_answer: { correct: "not given" } satisfies Prisma.InputJsonValue,
    },
  });
  await prisma.question.create({
    data: {
      id: `${test.id}-q-completion`,
      test_id: test.id,
      type: "reading-sentence-completion",
      prompt: "Two words max.",
      position: 2,
      correct_answer: {
        stem: "The sky is ___.",
        word_limit: 2,
        accepted: ["blue", "very blue"],
      } satisfies Prisma.InputJsonValue,
    },
  });
  return test;
}

async function seedAttemptWithAnswers(
  orgId: string,
  userId: string,
  testId: string,
  answers: { question_id: string; response: Prisma.InputJsonValue }[],
) {
  const attempt = await prisma.attempt.create({
    data: {
      org_id: orgId,
      user_id: userId,
      test_id: testId,
      section: "Reading",
      status: "Submitted",
      submitted_at: new Date(),
    },
  });
  for (const a of answers) {
    await prisma.answer.create({
      data: {
        org_id: orgId,
        attempt_id: attempt.id,
        question_id: a.question_id,
        response: a.response,
      },
    });
  }
  return attempt;
}

describe("persistReadingGrade — DB integration", () => {
  it("persists Grade + flips Attempt to Graded + backfills Answer.is_correct", async () => {
    const org = await createTestOrg("A");
    const learnerId = org.learnerIds[0]!;
    const test = await seedReadingTest();

    const attempt = await seedAttemptWithAnswers(org.id, learnerId, test.id, [
      {
        question_id: `${test.id}-q-mcq`,
        response: { kind: "reading-mcq", selected: "B" },
      },
      {
        question_id: `${test.id}-q-tfng`,
        response: { kind: "reading-true-false-not-given", selected: "Not Given" },
      },
      {
        question_id: `${test.id}-q-completion`,
        response: {
          kind: "reading-sentence-completion",
          text: "the sky is very, very blue",
        },
      },
    ]);

    const ctx = { ...ctxFor(org), user_id: learnerId, role: "Learner" as const };
    const db = withOrg(ctx);
    const result = await persistReadingGrade(db, ctx, attempt.id);

    expect(result.ok).toBe(true);
    expect(result.alreadyGraded).toBe(false);
    const grade = (result as { ok: true; grade: ReadingGrade }).grade;
    expect(grade.raw_total).toBe(3);
    // Q1 + Q2 correct, Q3 over the 2-word limit → incorrect.
    expect(grade.raw_correct).toBe(2);

    // Attempt + Grade rows reflect the result.
    const refreshed = await prisma.attempt.findUniqueOrThrow({
      where: { id: attempt.id },
      include: { grade: true, answers: true },
    });
    expect(refreshed.status).toBe("Graded");
    expect(refreshed.grade).not.toBeNull();
    expect(refreshed.grade?.band_overall.toString()).toBe("6.5"); // 2/3 → 27/40 → 6.5

    // Per-answer is_correct backfilled.
    const correctness = new Map(
      refreshed.answers.map((a) => [a.question_id, a.is_correct]),
    );
    expect(correctness.get(`${test.id}-q-mcq`)).toBe(true);
    expect(correctness.get(`${test.id}-q-tfng`)).toBe(true);
    expect(correctness.get(`${test.id}-q-completion`)).toBe(false);
  });

  it("missing answers are graded incorrect; the Answer row simply does not exist", async () => {
    const org = await createTestOrg("A");
    const learnerId = org.learnerIds[0]!;
    const test = await seedReadingTest();

    // Only the MCQ answer is submitted — the other two are simply absent.
    const attempt = await seedAttemptWithAnswers(org.id, learnerId, test.id, [
      {
        question_id: `${test.id}-q-mcq`,
        response: { kind: "reading-mcq", selected: "A" },
      },
    ]);

    const ctx = { ...ctxFor(org), user_id: learnerId, role: "Learner" as const };
    const result = await persistReadingGrade(withOrg(ctx), ctx, attempt.id);
    expect(result.ok).toBe(true);
    const grade = (result as { ok: true; grade: ReadingGrade }).grade;
    expect(grade.raw_correct).toBe(0);
    expect(grade.raw_total).toBe(3);
    expect(grade.breakdown.map((b) => b.is_correct)).toEqual([false, false, false]);

    const answerCount = await prisma.answer.count({
      where: { attempt_id: attempt.id },
    });
    expect(answerCount).toBe(1);
  });

  it("is idempotent — second call returns alreadyGraded and does not duplicate the Grade row", async () => {
    const org = await createTestOrg("A");
    const learnerId = org.learnerIds[0]!;
    const test = await seedReadingTest();

    const attempt = await seedAttemptWithAnswers(org.id, learnerId, test.id, [
      {
        question_id: `${test.id}-q-mcq`,
        response: { kind: "reading-mcq", selected: "B" },
      },
    ]);
    const ctx = { ...ctxFor(org), user_id: learnerId, role: "Learner" as const };

    const first = await persistReadingGrade(withOrg(ctx), ctx, attempt.id);
    expect(first.alreadyGraded).toBe(false);

    const second = await persistReadingGrade(withOrg(ctx), ctx, attempt.id);
    expect(second.alreadyGraded).toBe(true);
    expect(second.grade).toBeNull();

    const count = await prisma.grade.count({ where: { attempt_id: attempt.id } });
    expect(count).toBe(1);
  });

  it("refuses to grade an attempt belonging to a different user in the same org", async () => {
    const org = await createTestOrg("A");
    const learnerA = org.learnerIds[0]!;
    const learnerB = org.learnerIds[1]!;
    const test = await seedReadingTest();

    const attempt = await seedAttemptWithAnswers(org.id, learnerA, test.id, []);

    const ctxAsB = {
      org_id: org.id,
      user_id: learnerB,
      role: "Learner" as const,
    };
    await expect(
      persistReadingGrade(withOrg(ctxAsB), ctxAsB, attempt.id),
    ).rejects.toThrow(/Attempt not found/);
  });

  it("refuses to grade an attempt belonging to a different org", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    const test = await seedReadingTest();
    const attemptInA = await seedAttemptWithAnswers(
      orgA.id,
      orgA.learnerIds[0]!,
      test.id,
      [],
    );

    const ctxFromB = {
      org_id: orgB.id,
      user_id: orgB.learnerIds[0]!,
      role: "Learner" as const,
    };
    await expect(
      persistReadingGrade(withOrg(ctxFromB), ctxFromB, attemptInA.id),
    ).rejects.toThrow(/Attempt not found/);
  });
});
