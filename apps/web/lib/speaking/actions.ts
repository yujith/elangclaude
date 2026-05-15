"use server";

// Server actions for the Speaking attempt lifecycle.
//
// All actions go through `withOrg(ctx)` per the multi-tenancy rule — no raw
// Prisma for tenant-scoped reads/writes. Every action re-derives ctx from the
// signed session cookie. R2 keys and signed URLs are minted server-side from
// the authenticated ctx, so the client cannot smuggle a key from another org.
//
// Three layers run in sequence at end-of-test (Phase 3):
//   1. requestRecordingUpload — mints a short-lived signed PUT URL.
//   2. <client> uploads the recording bytes to R2.
//   3. finalizeSpeakingAttempt — downloads the bytes, runs Whisper,
//      splits by IELTS part, persists Recording + 3 Answer rows, flips
//      Attempt.status to Submitted.
//
// finalize is idempotent: re-calling it for an already-Submitted attempt
// returns ok without re-running Whisper.

import { Prisma, withOrg } from "@elc/db";
import {
  ProviderError,
  QuotaExceededError,
  ai,
  buildExaminerScript,
  loadExaminerPrompt,
  splitTranscriptByParts,
  type ExaminerScript,
  type TranscriptSegment,
} from "@elc/ai";
import {
  downloadObject,
  extensionForMimeType,
  recordingKey,
  signedUploadUrl,
} from "@elc/storage";
import { redirect } from "next/navigation";
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
// Marks the attempt as Abandoned when the learner ends the conversation
// WITHOUT producing a recording (e.g. they hit End before the long turn,
// or an error in the connecting stage). The recording + transcription
// path uses `finalizeSpeakingAttempt` instead, which transitions to
// Submitted.

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

// ─── requestRecordingUpload ──────────────────────────────────────────────
//
// Mints a short-lived signed PUT URL for the browser to upload the recorded
// conversation directly to R2. The key is derived server-side from the
// authenticated ctx + attemptId + mime type — the client cannot smuggle a
// key from another org or another attempt.

export type RequestRecordingUploadResult =
  | {
      ok: true;
      uploadUrl: string;
      key: string;
      contentType: string;
      expiresInSec: number;
    }
  | {
      ok: false;
      error:
        | "not_found"
        | "wrong_status"
        | "bad_mime"
        | "storage_unavailable"
        | "unknown";
    };

const UPLOAD_EXPIRY_SEC = 15 * 60;

export async function requestRecordingUpload(args: {
  attemptId: string;
  mimeType: string;
}): Promise<RequestRecordingUploadResult> {
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);

  const extension = extensionForMimeType(args.mimeType);
  if (!extension) {
    return { ok: false, error: "bad_mime" };
  }

  const attempt = await db.attempt.findUnique({
    where: { id: args.attemptId },
    select: { id: true, user_id: true, section: true, status: true },
  });
  if (
    !attempt ||
    attempt.user_id !== ctx.user_id ||
    attempt.section !== "Speaking"
  ) {
    return { ok: false, error: "not_found" };
  }
  if (attempt.status !== "InProgress") {
    return { ok: false, error: "wrong_status" };
  }

  const key = recordingKey({
    org_id: ctx.org_id,
    user_id: ctx.user_id,
    attempt_id: attempt.id,
    extension,
  });

  try {
    const uploadUrl = await signedUploadUrl({
      key,
      org_id: ctx.org_id,
      contentType: args.mimeType,
      expiresInSeconds: UPLOAD_EXPIRY_SEC,
    });
    return {
      ok: true,
      uploadUrl,
      key,
      contentType: args.mimeType,
      expiresInSec: UPLOAD_EXPIRY_SEC,
    };
  } catch (err) {
    console.error("[speaking] signedUploadUrl failed", {
      attempt_id: attempt.id,
      org_id: ctx.org_id,
      err,
    });
    return { ok: false, error: "storage_unavailable" };
  }
}

// ─── finalizeSpeakingAttempt ─────────────────────────────────────────────
//
// Runs AFTER the browser PUTs the recording to R2. Server-side it:
//   1. Re-derives the key from ctx + attemptId + mimeType (the client can't
//      smuggle a different key).
//   2. Downloads the recording bytes from R2.
//   3. Runs Whisper via the quota-gated `ai.transcribe`.
//   4. Splits the transcript into Part 1, Part 2, Part 3 using the runner-
//      captured stage boundaries (in ms relative to recording start).
//   5. Persists a Recording row + 3 Answer rows + flips Attempt.status to
//      Submitted in a single transaction.
//
// Idempotent: if Attempt is already Submitted/Graded the action returns ok
// without re-running Whisper (Phase 4's grader will be a separate seam).

export type StageBoundariesMs = {
  // ms relative to recording start. Each must be non-decreasing.
  part1End: number;
  part2PrepEnd: number;
  part2LongTurnEnd: number;
  part2FollowupEnd: number;
  part3End: number;
};

export type FinalizeSpeakingResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "not_found"
        | "wrong_status"
        | "bad_mime"
        | "bad_boundaries"
        | "missing_questions"
        | "storage_unavailable"
        | "quota"
        | "transcribe"
        | "unknown";
    };

const MS_PER_SEC = 1000;

function validateBoundaries(b: StageBoundariesMs, durationMs: number): boolean {
  const ordered =
    b.part1End <= b.part2PrepEnd &&
    b.part2PrepEnd <= b.part2LongTurnEnd &&
    b.part2LongTurnEnd <= b.part2FollowupEnd &&
    b.part2FollowupEnd <= b.part3End;
  if (!ordered) return false;
  // Each boundary must lie within the recording. We allow a 2-second slop
  // either side because MediaRecorder.stop fires shortly after the last
  // transition timestamp.
  const SLOP_MS = 2000;
  return b.part3End >= 0 && b.part3End <= durationMs + SLOP_MS;
}

export async function finalizeSpeakingAttempt(args: {
  attemptId: string;
  mimeType: string;
  durationMs: number;
  boundariesMs: StageBoundariesMs;
}): Promise<FinalizeSpeakingResult> {
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);

  const extension = extensionForMimeType(args.mimeType);
  if (!extension) {
    return { ok: false, error: "bad_mime" };
  }
  if (!validateBoundaries(args.boundariesMs, args.durationMs)) {
    return { ok: false, error: "bad_boundaries" };
  }

  const attempt = await db.attempt.findUnique({
    where: { id: args.attemptId },
    select: {
      id: true,
      user_id: true,
      section: true,
      status: true,
      test: {
        select: {
          id: true,
          section: true,
          questions: {
            select: { id: true, type: true, position: true },
            orderBy: { position: "asc" },
          },
        },
      },
    },
  });
  if (
    !attempt ||
    attempt.user_id !== ctx.user_id ||
    attempt.section !== "Speaking" ||
    attempt.test.section !== "Speaking"
  ) {
    return { ok: false, error: "not_found" };
  }
  if (attempt.status === "Submitted" || attempt.status === "Graded") {
    // Already finalized — idempotent return so the client's retry is safe.
    return { ok: true };
  }
  if (attempt.status !== "InProgress") {
    return { ok: false, error: "wrong_status" };
  }

  // Lock onto the three IELTS-part Question anchors by type.
  const questionByType = new Map<string, string>();
  for (const q of attempt.test.questions) {
    questionByType.set(q.type, q.id);
  }
  const part1QuestionId = questionByType.get("speaking-part-1");
  const part2QuestionId = questionByType.get("speaking-part-2-cue");
  const part3QuestionId = questionByType.get("speaking-part-3");
  if (!part1QuestionId || !part2QuestionId || !part3QuestionId) {
    return { ok: false, error: "missing_questions" };
  }

  const key = recordingKey({
    org_id: ctx.org_id,
    user_id: ctx.user_id,
    attempt_id: attempt.id,
    extension,
  });

  // ── 1. Pull the audio bytes from R2 ────────────────────────────────────
  let audio: Uint8Array;
  try {
    audio = await downloadObject({ key, org_id: ctx.org_id });
  } catch (err) {
    console.error("[speaking] downloadObject failed", {
      attempt_id: attempt.id,
      key,
      err,
    });
    return { ok: false, error: "storage_unavailable" };
  }

  // ── 2. Whisper transcription (quota-gated) ─────────────────────────────
  let transcribed: {
    text: string;
    segments: TranscriptSegment[];
    duration_sec: number;
  };
  try {
    transcribed = await ai.transcribe({
      ctx,
      audio,
      filename: `${attempt.id}.${extension}`,
      mimeType: args.mimeType,
      language: "en",
    });
  } catch (err) {
    if (err instanceof QuotaExceededError) return { ok: false, error: "quota" };
    if (err instanceof ProviderError) {
      console.error("[speaking] transcribe failed", {
        attempt_id: attempt.id,
        org_id: ctx.org_id,
        err,
      });
      return { ok: false, error: "transcribe" };
    }
    console.error("[speaking] transcribe unknown failure", {
      attempt_id: attempt.id,
      err,
    });
    return { ok: false, error: "unknown" };
  }

  // ── 3. Per-IELTS-part split ────────────────────────────────────────────
  const b = args.boundariesMs;
  const split = splitTranscriptByParts({
    segments: transcribed.segments,
    part1: { startSec: 0, endSec: b.part1End / MS_PER_SEC },
    // Skip the silent prep minute — Part 2 in the transcript starts at the
    // long-turn boundary.
    part2: {
      startSec: b.part2PrepEnd / MS_PER_SEC,
      endSec: b.part2FollowupEnd / MS_PER_SEC,
    },
    part3: {
      startSec: b.part2FollowupEnd / MS_PER_SEC,
      endSec: b.part3End / MS_PER_SEC,
    },
  });

  // The Recording.duration_sec column is Int — round from ms.
  const durationSec = Math.max(
    1,
    Math.round((transcribed.duration_sec || args.durationMs / MS_PER_SEC) || 1),
  );

  // ── 4. Persist Recording + 3 Answer rows + flip Attempt to Submitted ──
  const answerPayload = (part: { text: string; segments: TranscriptSegment[] }) =>
    ({
      text: part.text,
      segments: part.segments,
      saved_at: new Date().toISOString(),
    }) as unknown as Prisma.InputJsonValue;

  try {
    await db.$transaction([
      db.recording.create({
        data: {
          org_id: ctx.org_id,
          attempt_id: attempt.id,
          storage_url: key,
          duration_sec: durationSec,
        },
      }),
      db.answer.upsert({
        where: {
          attempt_id_question_id: {
            attempt_id: attempt.id,
            question_id: part1QuestionId,
          },
        },
        create: {
          org_id: ctx.org_id,
          attempt_id: attempt.id,
          question_id: part1QuestionId,
          response: answerPayload(split.part1),
        },
        update: { response: answerPayload(split.part1) },
      }),
      db.answer.upsert({
        where: {
          attempt_id_question_id: {
            attempt_id: attempt.id,
            question_id: part2QuestionId,
          },
        },
        create: {
          org_id: ctx.org_id,
          attempt_id: attempt.id,
          question_id: part2QuestionId,
          response: answerPayload(split.part2),
        },
        update: { response: answerPayload(split.part2) },
      }),
      db.answer.upsert({
        where: {
          attempt_id_question_id: {
            attempt_id: attempt.id,
            question_id: part3QuestionId,
          },
        },
        create: {
          org_id: ctx.org_id,
          attempt_id: attempt.id,
          question_id: part3QuestionId,
          response: answerPayload(split.part3),
        },
        update: { response: answerPayload(split.part3) },
      }),
      db.attempt.update({
        where: { id: attempt.id },
        data: { status: "Submitted", submitted_at: new Date() },
      }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error("[speaking] finalize transaction failed", {
      attempt_id: attempt.id,
      err,
    });
    return { ok: false, error: "unknown" };
  }
}
