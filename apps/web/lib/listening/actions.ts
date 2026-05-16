"use server";

// Server actions for the Listening attempt lifecycle.
//
// Mirrors apps/web/lib/reading/actions.ts — Listening is deterministically
// graded (no AI hop on submit), so the structure is the same. The two
// Listening-specific additions are:
//   1. `issueSignedAudioUrl` — mints a short-lived signed R2 URL for a
//      specific audio_clip hash. The clip must belong to the attempt's
//      Test (parsed from body_json) — otherwise we'd be a free CDN for
//      any sha256 a learner cared to guess.
//   2. The autosave response shapes carry the five Phase-1 Listening
//      kinds (mcq-single / mcq-multi / sentence-completion /
//      short-answer / completion-blank).
//
// Every read/write goes through `withOrg(ctx)`. `Test` and `Question`
// are global and pass through unscoped.

import { redirect } from "next/navigation";
import { withOrg } from "@elc/db";
import type { OrgContext } from "@elc/db";
import {
  isListeningQuestionKind,
  ListeningPersistError,
  parseListeningContent,
  persistListeningGrade,
} from "@elc/ai";
import { audioKey, signedAudioDownloadUrl } from "@elc/storage";
import { requireOrgContext } from "@/lib/auth/context";

export type ListeningAutosaveResult =
  | { ok: true; savedAt: string }
  | { ok: false; error: "not_found" | "already_submitted" | "invalid" };

// JSON-safe shapes the client sends. The runner is the only caller; any
// shape outside this union is a coding bug and we reject the autosave.
export type ClientListeningResponse =
  | { kind: "listening-mcq-single"; selected: string | null }
  | { kind: "listening-mcq-multi"; selected: string[] }
  | { kind: "listening-sentence-completion"; text: string }
  | { kind: "listening-short-answer"; text: string }
  | { kind: "listening-completion-blank"; text: string };

// ─── Attempt lifecycle ──────────────────────────────────────────────────

export async function startListeningAttempt(formData: FormData): Promise<void> {
  const ctx = await requireOrgContext();
  const testId = formData.get("testId");
  if (typeof testId !== "string" || testId.length === 0) {
    throw new Error("Missing testId.");
  }
  const db = withOrg(ctx);

  const test = await db.test.findUnique({
    where: { id: testId },
    select: { id: true, section: true, status: true },
  });
  if (!test || test.section !== "Listening" || test.status !== "Approved") {
    throw new Error("Test is not available.");
  }

  const attempt = await db.attempt.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      test_id: test.id,
      section: "Listening",
      status: "InProgress",
    },
    select: { id: true },
  });

  redirect(`/practice/listening/${attempt.id}`);
}

export async function autosaveListeningAnswer(
  attemptId: string,
  questionId: string,
  payload: ClientListeningResponse,
): Promise<ListeningAutosaveResult> {
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);

  if (!payload || !isListeningQuestionKind(payload.kind)) {
    return { ok: false, error: "invalid" };
  }

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

export async function submitListeningAttempt(formData: FormData): Promise<void> {
  const ctx = await requireOrgContext();
  const attemptId = formData.get("attemptId");
  if (typeof attemptId !== "string" || attemptId.length === 0) {
    throw new Error("Missing attemptId.");
  }
  // Check whether this attempt belongs to a mock BEFORE grading — the
  // redirect target differs (mock orchestrator vs per-section results
  // page). Grading itself is the same either way.
  const db = withOrg(ctx);
  const meta = await db.attempt.findUnique({
    where: { id: attemptId },
    select: { mock_session_id: true, user_id: true },
  });
  await runListeningSubmit(ctx, attemptId);
  if (meta && meta.user_id === ctx.user_id && meta.mock_session_id) {
    redirect(`/mock/${meta.mock_session_id}`);
  }
  redirect(`/results/${attemptId}`);
}

export async function regradeListeningAttempt(formData: FormData): Promise<void> {
  // Re-runs deterministic grading. Same affordance as the Reading
  // equivalent: surfaced from the results page on the rare "we couldn't
  // grade this" state.
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
  if (attempt.grade) redirect(`/results/${attempt.id}`);
  if (attempt.status === "InProgress") {
    throw new Error("Attempt has not been submitted yet.");
  }
  await runListeningGrading(ctx, attempt.id);
  redirect(`/results/${attempt.id}`);
}

// ─── Audio URL minting ──────────────────────────────────────────────────

export type IssueAudioUrlResult =
  | { ok: true; url: string; expires_in_seconds: number }
  | { ok: false; error: "not_found" | "unknown_clip" };

// Mints a short-lived signed URL for a single audio clip. The clip must
// be referenced by the attempt's parent Test (via the body_json
// transcript's audio_clip fields); a learner asking for an arbitrary
// sha256 they don't own is rejected. Audio objects themselves are global
// (ADR 0007 D5) so the signed URL carries no org_id — the authorisation
// is here, on the minter.
export async function issueSignedAudioUrl(
  attemptId: string,
  sha256: string,
): Promise<IssueAudioUrlResult> {
  const ctx = await requireOrgContext();
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
    return { ok: false, error: "unknown_clip" };
  }
  const db = withOrg(ctx);

  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      user_id: true,
      test: { select: { body_json: true, section: true } },
    },
  });
  if (
    !attempt ||
    attempt.user_id !== ctx.user_id ||
    attempt.test.section !== "Listening"
  ) {
    return { ok: false, error: "not_found" };
  }

  const content = parseListeningContent(attempt.test.body_json);
  if (!content) return { ok: false, error: "not_found" };

  // Collect every clip sha256 referenced by the parsed content.
  const ownedClips = new Set<string>();
  let format: "mp3" | "wav" | "ogg" = "mp3";
  for (const part of content.parts) {
    for (const seg of part.transcript) {
      if (seg.kind !== "speech" && seg.kind !== "narration") continue;
      if (!seg.audio_clip) continue;
      ownedClips.add(seg.audio_clip.sha256);
      // Default to the most-recent clip's format. v1 only ships mp3, so
      // the loop almost always observes one format.
      format = seg.audio_clip.format;
    }
  }

  if (!ownedClips.has(sha256)) {
    return { ok: false, error: "unknown_clip" };
  }

  const key = audioKey({ sha256, extension: format });
  const url = await signedAudioDownloadUrl({ key });
  return { ok: true, url, expires_in_seconds: 15 * 60 };
}

// ─── Internals ──────────────────────────────────────────────────────────

async function runListeningSubmit(
  ctx: OrgContext,
  attemptId: string,
): Promise<void> {
  const db = withOrg(ctx);
  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    select: { id: true, user_id: true, status: true },
  });
  if (!attempt || attempt.user_id !== ctx.user_id) {
    throw new Error("Attempt not found.");
  }
  if (attempt.status !== "InProgress") return; // idempotent
  await db.attempt.update({
    where: { id: attempt.id },
    data: { status: "Submitted", submitted_at: new Date() },
  });
  await runListeningGrading(ctx, attempt.id);
}

async function runListeningGrading(
  ctx: OrgContext,
  attemptId: string,
): Promise<void> {
  const db = withOrg(ctx);
  try {
    await persistListeningGrade(db, ctx, attemptId);
  } catch (err) {
    if (err instanceof ListeningPersistError) throw new Error(err.message);
    throw err;
  }
}
