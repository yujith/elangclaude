"use server";

// Server actions for the Speaking attempt lifecycle (v1 — live conversation
// only; recording + transcription + grading land in Phase 3 / 4).
//
// All actions go through `withOrg(ctx)` per the multi-tenancy rule — no raw
// Prisma for tenant-scoped reads/writes. Every action re-derives ctx from the
// signed session cookie.
//
// `createRealtimeSession` is the bridge between an authenticated learner and
// the OpenAI Realtime API: it validates the attempt, builds the per-stage
// examiner instructions from the Test's body_json, and mints an ephemeral
// token through the AI gateway (which quota-gates the session).

import { redirect } from "next/navigation";
import { withOrg } from "@elc/db";
import {
  ProviderError,
  QuotaExceededError,
  ai,
  buildExaminerScript,
  loadExaminerPrompt,
  type ExaminerScript,
} from "@elc/ai";
import { requireOrgContext } from "@/lib/auth/context";
import { parseSpeakingContent } from "@/lib/speaking/content";

// ─── startSpeakingAttempt ────────────────────────────────────────────────

export async function startSpeakingAttempt(formData: FormData): Promise<void> {
  const ctx = await requireOrgContext();
  const testId = formData.get("testId");
  if (typeof testId !== "string" || testId.length === 0) {
    throw new Error("Missing testId.");
  }
  const db = withOrg(ctx);

  // Test is a global model — withOrg passes through unchanged. We still
  // require the test to be Approved + Speaking before we create an Attempt
  // against it.
  const test = await db.test.findUnique({
    where: { id: testId },
    select: { id: true, section: true, status: true },
  });
  if (!test || test.section !== "Speaking" || test.status !== "Approved") {
    throw new Error("Test is not available.");
  }

  const attempt = await db.attempt.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      test_id: test.id,
      section: "Speaking",
      status: "InProgress",
    },
    select: { id: true },
  });

  redirect(`/practice/speaking/${attempt.id}`);
}

// ─── createRealtimeSession ───────────────────────────────────────────────

export type CreateRealtimeSessionResult =
  | {
      ok: true;
      client_secret: string;
      model: string;
      expires_at: number;
      script: ExaminerScript;
    }
  | {
      ok: false;
      error:
        | "not_found"
        | "wrong_status"
        | "no_content"
        | "quota"
        | "provider"
        | "unknown";
    };

// Mints an ephemeral OpenAI Realtime token for this attempt's Speaking test
// and returns the per-stage examiner script the runner relays to the model.
// Reserve-on-mint quota accounting per ADR 0005 (D4).
export async function createRealtimeSession(
  attemptId: string,
): Promise<CreateRealtimeSessionResult> {
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);

  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      user_id: true,
      section: true,
      status: true,
      test: { select: { id: true, body_json: true, section: true } },
    },
  });

  if (!attempt || attempt.user_id !== ctx.user_id) {
    return { ok: false, error: "not_found" };
  }
  if (attempt.section !== "Speaking" || attempt.test.section !== "Speaking") {
    return { ok: false, error: "not_found" };
  }
  if (attempt.status !== "InProgress") {
    return { ok: false, error: "wrong_status" };
  }

  const content = parseSpeakingContent(attempt.test.body_json);
  if (!content) {
    return { ok: false, error: "no_content" };
  }

  const script = buildExaminerScript({
    persona: loadExaminerPrompt(),
    content,
  });

  try {
    const session = await ai.realtimeSession({
      ctx,
      instructions: script.part1.instructions,
      // v1 voice — Phase 5 polish does accent variety.
      voice: "alloy",
    });
    return {
      ok: true,
      client_secret: session.client_secret,
      model: session.model,
      expires_at: session.expires_at,
      script,
    };
  } catch (err) {
    if (err instanceof QuotaExceededError) return { ok: false, error: "quota" };
    if (err instanceof ProviderError) {
      console.error("[speaking] realtime mint failed", {
        attempt_id: attempt.id,
        org_id: ctx.org_id,
        user_id: ctx.user_id,
        err,
      });
      return { ok: false, error: "provider" };
    }
    console.error("[speaking] realtime mint unknown failure", {
      attempt_id: attempt.id,
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      err,
    });
    return { ok: false, error: "unknown" };
  }
}

// ─── endSpeakingAttempt ──────────────────────────────────────────────────
//
// Phase 2 only: marks the attempt as Abandoned when the learner ends the
// conversation without going through the (Phase 3 / 4) recording + grading
// path. Phase 3 will add `finalizeSpeakingAttempt` which transitions to
// Submitted with a recording + transcript. Until then, Abandoned is the
// honest status for a v1 conversation that produced no graded artifact.

export type EndSpeakingResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "wrong_status" | "unknown" };

export async function endSpeakingAttempt(
  attemptId: string,
): Promise<EndSpeakingResult> {
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);

  try {
    const attempt = await db.attempt.findUnique({
      where: { id: attemptId },
      select: { id: true, user_id: true, section: true, status: true },
    });
    if (!attempt || attempt.user_id !== ctx.user_id) {
      return { ok: false, error: "not_found" };
    }
    if (attempt.section !== "Speaking") {
      return { ok: false, error: "not_found" };
    }
    if (attempt.status !== "InProgress") {
      // Idempotent — calling end on an already-ended attempt is fine.
      return { ok: true };
    }
    await db.attempt.update({
      where: { id: attempt.id },
      data: { status: "Abandoned", submitted_at: new Date() },
    });
    return { ok: true };
  } catch (err) {
    console.error("[speaking] endSpeakingAttempt failed", { attemptId, err });
    return { ok: false, error: "unknown" };
  }
}
