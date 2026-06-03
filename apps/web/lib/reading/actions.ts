"use server";

// Server actions for the Reading attempt lifecycle.
//
// Mirrors apps/web/lib/attempts/actions.ts (Writing) with two differences:
//   1. The Answer.response shape is per-question-type (see @elc/ai
//      reading/question-types.ts).
//   2. Submit grades deterministically inside this file — there is no AI
//      call, no gateway hop, no quota touch.
//
// Every read/write goes through `withOrg(ctx)`. `Test` and `Question` are
// global and pass through unscoped, exactly as Writing does today.

import { redirect } from "next/navigation";
import { withOrg } from "@elc/db";
import type { OrgContext } from "@elc/db";
import {
  isReadingQuestionKind,
  persistReadingGrade,
  ReadingPersistError,
} from "@elc/ai";
import { requireOrgContext } from "@/lib/auth/context";

export type ReadingAutosaveResult =
  | { ok: true; savedAt: string }
  | { ok: false; error: "not_found" | "already_submitted" | "invalid" };

// JSON-safe shape we accept from the client for a single question's
// response. The runner is the only caller and writes exactly this shape;
// anything else is a coding bug and we reject the autosave.
export type ClientResponsePayload =
  | { kind: "reading-mcq"; selected: string | null }
  | { kind: "reading-true-false-not-given"; selected: string | null }
  | { kind: "reading-yes-no-not-given"; selected: string | null }
  | { kind: "reading-sentence-completion"; text: string }
  | { kind: "reading-matching-headings"; selected: string | null }
  | { kind: "reading-matching-information"; selected: string | null }
  | { kind: "reading-matching-features"; selected: string | null }
  | { kind: "reading-matching-sentence-endings"; selected: string | null }
  | { kind: "reading-short-answer"; text: string }
  | { kind: "reading-completion-blank"; text: string };

export async function startReadingAttempt(formData: FormData): Promise<void> {
  const ctx = await requireOrgContext();
  const testId = formData.get("testId");
  if (typeof testId !== "string" || testId.length === 0) {
    throw new Error("Missing testId.");
  }
  const db = withOrg(ctx);

  // Test is a global model — withOrg passes through unchanged. We still
  // require the test to be Approved + Reading before we create an Attempt.
  const test = await db.test.findUnique({
    where: { id: testId },
    select: { id: true, section: true, status: true },
  });
  if (!test || test.section !== "Reading" || test.status !== "Approved") {
    throw new Error("Test is not available.");
  }

  const attempt = await db.attempt.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      test_id: test.id,
      section: "Reading",
      status: "InProgress",
    },
    select: { id: true },
  });

  redirect(`/practice/reading/${attempt.id}`);
}

export async function autosaveReadingAnswer(
  attemptId: string,
  questionId: string,
  payload: ClientResponsePayload,
): Promise<ReadingAutosaveResult> {
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);

  if (!payload || !isReadingQuestionKind(payload.kind)) {
    return { ok: false, error: "invalid" };
  }

  // Confirm the attempt belongs to the caller and is still in progress,
  // then confirm the question belongs to the attempt's test. Both reads
  // are cheap and protect against tampering with the questionId.
  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      user_id: true,
      status: true,
      test: {
        select: {
          questions: { select: { id: true, type: true } },
        },
      },
    },
  });
  if (!attempt || attempt.user_id !== ctx.user_id) {
    return { ok: false, error: "not_found" };
  }
  if (attempt.status !== "InProgress") {
    return { ok: false, error: "already_submitted" };
  }
  const question = attempt.test.questions.find((q) => q.id === questionId);
  if (!question || question.type !== payload.kind) {
    return { ok: false, error: "invalid" };
  }

  const savedAt = new Date().toISOString();
  const response = { ...payload, saved_at: savedAt };

  await db.answer.upsert({
    where: {
      attempt_id_question_id: {
        attempt_id: attempt.id,
        question_id: question.id,
      },
    },
    create: {
      org_id: ctx.org_id,
      attempt_id: attempt.id,
      question_id: question.id,
      response,
    },
    update: { response },
  });

  return { ok: true, savedAt };
}

export async function submitReadingAttempt(formData: FormData): Promise<void> {
  const ctx = await requireOrgContext();
  const attemptId = formData.get("attemptId");
  if (typeof attemptId !== "string" || attemptId.length === 0) {
    throw new Error("Missing attemptId.");
  }

  await runReadingSubmit(ctx, attemptId);

  // If this attempt is one leg of a full Reading paper, route back to the
  // paper orchestrator so it can advance to the next part (or the paper
  // result) instead of showing the single-passage result page.
  const db = withOrg(ctx);
  const submitted = await db.attempt.findUnique({
    where: { id: attemptId },
    select: { reading_paper_session_id: true },
  });
  if (submitted?.reading_paper_session_id) {
    redirect(`/practice/reading/paper/${submitted.reading_paper_session_id}`);
  }
  redirect(`/results/${attemptId}`);
}

export async function regradeReadingAttempt(formData: FormData): Promise<void> {
  // Re-runs deterministic grading. Only needed if a grader bug shipped and
  // someone manually re-queued a Submitted attempt for re-grading. The
  // results page surfaces a "Try grading again" button on the rare "we
  // couldn't grade this" state.
  const ctx = await requireOrgContext();
  const attemptId = formData.get("attemptId");
  if (typeof attemptId !== "string" || attemptId.length === 0) {
    throw new Error("Missing attemptId.");
  }
  const db = withOrg(ctx);

  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    select: { id: true, user_id: true, status: true, grade: { select: { id: true } } },
  });
  if (!attempt || attempt.user_id !== ctx.user_id) {
    throw new Error("Attempt not found.");
  }
  if (attempt.grade) {
    redirect(`/results/${attempt.id}`);
  }
  if (attempt.status === "InProgress") {
    throw new Error("Attempt has not been submitted yet.");
  }

  await runReadingGrading(ctx, attempt.id);
  redirect(`/results/${attempt.id}`);
}

// ─── Internals ──────────────────────────────────────────────────────────

async function runReadingSubmit(ctx: OrgContext, attemptId: string): Promise<void> {
  const db = withOrg(ctx);

  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    select: { id: true, user_id: true, status: true },
  });
  if (!attempt || attempt.user_id !== ctx.user_id) {
    throw new Error("Attempt not found.");
  }
  if (attempt.status !== "InProgress") {
    // Idempotent: re-submit just routes to results.
    return;
  }

  await db.attempt.update({
    where: { id: attempt.id },
    data: { status: "Submitted", submitted_at: new Date() },
  });
  await runReadingGrading(ctx, attempt.id);
}

async function runReadingGrading(ctx: OrgContext, attemptId: string): Promise<void> {
  const db = withOrg(ctx);
  try {
    await persistReadingGrade(db, ctx, attemptId);
  } catch (err) {
    if (err instanceof ReadingPersistError) throw new Error(err.message);
    throw err;
  }
}
