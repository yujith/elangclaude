"use server";

// Server actions for the Writing attempt lifecycle.
//
// All three actions go through `withOrg(ctx)` per the multi-tenancy rule —
// no raw Prisma in this file. Every action re-derives ctx from the signed
// session cookie, so a stale form posted after sign-out simply 401s.
//
// Ownership: an Attempt belongs to a User, who belongs to an Org. The
// withOrg proxy enforces org-scoping automatically; we add an explicit
// user_id check on top because two learners in the same org should not see
// each other's attempts.

import { redirect } from "next/navigation";
import { Prisma, withOrg } from "@elc/db";
import type { OrgContext } from "@elc/db";
import {
  GradeShapeError,
  ProviderError,
  QuotaExceededError,
  writingGrader,
  type WritingTaskKind,
} from "@elc/ai";
import { requireOrgContext } from "@/lib/auth/context";
import { isWritingTaskType } from "@/lib/writing/task";

type AutosaveResult =
  | { ok: true; savedAt: string }
  | { ok: false; error: "not_found" | "already_submitted" | "unknown" };

export async function startAttempt(formData: FormData): Promise<void> {
  const ctx = await requireOrgContext();
  const testId = formData.get("testId");
  if (typeof testId !== "string" || testId.length === 0) {
    throw new Error("Missing testId.");
  }
  const db = withOrg(ctx);

  // Test is a global model — withOrg passes through unchanged. We still
  // require the test to be Approved + Writing before we create an Attempt
  // against it (defence in depth against a stale or unapproved testId).
  const test = await db.test.findUnique({
    where: { id: testId },
    select: { id: true, section: true, status: true },
  });
  if (!test || test.section !== "Writing" || test.status !== "Approved") {
    throw new Error("Test is not available.");
  }

  // withOrg clamps `org_id` to ctx.org_id regardless of what we pass, so
  // the explicit value here is purely to satisfy Prisma's generated types
  // (which don't know about the proxy). Same pattern for every create below.
  const attempt = await db.attempt.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      test_id: test.id,
      section: "Writing",
      status: "InProgress",
    },
    select: { id: true },
  });

  redirect(`/practice/writing/${attempt.id}`);
}

export async function autosaveAttempt(
  attemptId: string,
  text: string,
): Promise<AutosaveResult> {
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);

  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      user_id: true,
      status: true,
      test: { select: { questions: { select: { id: true }, take: 1 } } },
    },
  });

  if (!attempt || attempt.user_id !== ctx.user_id) {
    return { ok: false, error: "not_found" };
  }
  if (attempt.status !== "InProgress") {
    return { ok: false, error: "already_submitted" };
  }
  const question = attempt.test.questions[0];
  if (!question) return { ok: false, error: "unknown" };

  // The Answer JSON shape is owned by the Writing module — keep it small
  // and structured so future grading reads exactly what was submitted.
  const response = {
    text,
    word_count: text ? text.trim().split(/\s+/).filter(Boolean).length : 0,
    saved_at: new Date().toISOString(),
  };

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
    update: {
      response,
    },
  });

  return { ok: true, savedAt: response.saved_at };
}

export async function submitAttempt(formData: FormData): Promise<void> {
  const ctx = await requireOrgContext();
  const attemptId = formData.get("attemptId");
  const finalText = formData.get("response");
  if (typeof attemptId !== "string" || attemptId.length === 0) {
    throw new Error("Missing attemptId.");
  }
  const db = withOrg(ctx);

  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      user_id: true,
      status: true,
      test: { select: { questions: { select: { id: true }, take: 1 } } },
    },
  });
  if (!attempt || attempt.user_id !== ctx.user_id) {
    throw new Error("Attempt not found.");
  }
  if (attempt.status !== "InProgress") {
    // Idempotent: re-submit just bounces to results.
    redirect(`/results/${attempt.id}`);
  }

  // Persist whatever text the client posted with the submit — even if the
  // last autosave was a moment ago, the final POST wins. Mirrors how a real
  // user expects "submit" to capture exactly what they see.
  if (typeof finalText === "string") {
    const question = attempt.test.questions[0];
    if (question) {
      const response = {
        text: finalText,
        word_count: finalText
          ? finalText.trim().split(/\s+/).filter(Boolean).length
          : 0,
        saved_at: new Date().toISOString(),
      };
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
    }
  }

  await db.attempt.update({
    where: { id: attempt.id },
    data: { status: "Submitted", submitted_at: new Date() },
  });

  // Inline grading. v1 accepts the 15-25s wait on submit — the form's
  // `useFormStatus` keeps the button disabled until redirect. A polling
  // UX is Phase 6 polish if this latency becomes a problem.
  const outcome = await tryGrade(ctx, attempt.id);
  redirect(resultsUrl(attempt.id, outcome));
}

export async function regradeAttempt(formData: FormData): Promise<void> {
  // Re-runs grading for any Submitted-but-not-Graded attempt. Used by the
  // "Try grading again" button on the results page when a previous run
  // hit a provider hiccup or schema rejection.
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
    // Shouldn't happen via the UI but be defensive.
    throw new Error("Attempt has not been submitted yet.");
  }

  const outcome = await tryGrade(ctx, attempt.id);
  redirect(resultsUrl(attempt.id, outcome));
}

// ─── Grading orchestration ──────────────────────────────────────────────

type GradeOutcome = "ok" | "quota" | "grading" | "unknown";

function resultsUrl(attemptId: string, outcome: GradeOutcome): string {
  if (outcome === "ok") return `/results/${attemptId}`;
  return `/results/${attemptId}?error=${outcome}`;
}

async function tryGrade(
  ctx: OrgContext,
  attemptId: string,
): Promise<GradeOutcome> {
  try {
    await runWritingGrading(ctx, attemptId);
    return "ok";
  } catch (err) {
    if (err instanceof QuotaExceededError) return "quota";
    // Both of these surface to the UI as `?error=grading`. Log the actual
    // cause so a "Grading hit a snag" report is diagnosable from the server
    // logs — previously this branch was swallowed silently.
    if (err instanceof GradeShapeError) {
      console.error(
        "[grading] attempt %s — GradeShapeError: model JSON failed schema validation after retry. issues=%o rawSnippet=%s",
        attemptId,
        err.issues,
        err.raw.slice(0, 500),
      );
      return "grading";
    }
    if (err instanceof ProviderError) {
      console.error(
        "[grading] attempt %s — ProviderError from %s: %s",
        attemptId,
        err.provider,
        err.message,
      );
      return "grading";
    }
    console.error(
      "[grading] attempt %s — unexpected grading failure:",
      attemptId,
      err,
    );
    return "unknown";
  }
}

async function runWritingGrading(
  ctx: OrgContext,
  attemptId: string,
): Promise<void> {
  const db = withOrg(ctx);

  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      user_id: true,
      status: true,
      test: {
        select: {
          questions: {
            select: { id: true, type: true, prompt: true },
            orderBy: { position: "asc" },
            take: 1,
          },
        },
      },
      answers: { select: { response: true }, take: 1 },
      grade: { select: { id: true } },
    },
  });
  if (!attempt || attempt.user_id !== ctx.user_id) {
    throw new Error("Attempt not found.");
  }
  if (attempt.grade) {
    // Already graded — nothing to do. Caller redirects to results.
    return;
  }

  const question = attempt.test.questions[0];
  if (!question || !isWritingTaskType(question.type)) {
    throw new Error("Unsupported task type for grading.");
  }
  const taskType = question.type as WritingTaskKind;

  const answerJson = attempt.answers[0]?.response;
  const responseText = readResponseText(answerJson);
  if (!responseText || responseText.trim().length === 0) {
    throw new Error("Cannot grade an empty response.");
  }

  const result = await writingGrader.grade({
    ctx,
    taskType,
    taskPrompt: question.prompt,
    responseText,
  });

  // Persist in a single transaction so we never end up with a Grade row
  // pointing at an Attempt that's still status=Submitted.
  await db.$transaction([
    db.grade.create({
      data: {
        org_id: ctx.org_id,
        attempt_id: attempt.id,
        band_overall: new Prisma.Decimal(result.grade.band_overall),
        criteria_scores_json: result.grade as unknown as Prisma.InputJsonValue,
        feedback_text: null,
        graded_by: "AI",
      },
    }),
    db.attempt.update({
      where: { id: attempt.id },
      data: { status: "Graded" },
    }),
  ]);
}

function readResponseText(raw: unknown): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as { text?: unknown };
    if (typeof obj.text === "string") return obj.text;
  }
  return "";
}
