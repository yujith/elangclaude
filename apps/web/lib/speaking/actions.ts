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
import type { OrgContext } from "@elc/db";
import {
  GradeShapeError,
  ProviderError,
  QuotaExceededError,
  ai,
  buildExaminerScript,
  extractAudioFeatures,
  loadExaminerPrompt,
  speakingGrader,
  splitTranscriptByParts,
  type ExaminerScript,
  type SpeakingPartKey,
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
      // Deterministic voice rotation per attempt — same attempt always
      // gets the same voice across retries / reconnects, but a learner
      // doing multiple attempts hears a different examiner each time.
      voice: voiceForAttempt(attempt.id),
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
  if (attempt.status === "Graded") {
    // Already graded — idempotent return so the client's retry is safe.
    return { ok: true };
  }
  if (attempt.status === "Submitted") {
    // Transcripts already persisted on a prior call; only the grade is
    // still pending. Skip the download/transcribe path and re-try grading.
    await tryGradeSpeaking(ctx, attempt.id);
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
  } catch (err) {
    console.error("[speaking] finalize transaction failed", {
      attempt_id: attempt.id,
      err,
    });
    return { ok: false, error: "unknown" };
  }

  // Transcripts are saved; the attempt is Submitted. Now run grading.
  // Failures here do NOT roll back the transcripts — the results page
  // surfaces a "Try grading again" retry that re-runs this same code
  // path (idempotent on Submitted entry).
  await tryGradeSpeaking(ctx, attempt.id);
  return { ok: true };
}

// ─── Grading orchestration ───────────────────────────────────────────────
//
// Grading is wired as a separate idempotent step that re-runs cleanly on
// retry. The finalize flow always calls it after the transcripts land; if
// it fails, the attempt stays in Submitted and `regradeSpeakingAttempt`
// can retry it from the results page.

type SpeakingGradeOutcome = "ok" | "quota" | "grading" | "unknown";

async function tryGradeSpeaking(
  ctx: OrgContext,
  attemptId: string,
): Promise<SpeakingGradeOutcome> {
  try {
    await runSpeakingGrading(ctx, attemptId);
    return "ok";
  } catch (err) {
    if (err instanceof QuotaExceededError) return "quota";
    if (err instanceof ProviderError || err instanceof GradeShapeError) {
      console.error("[speaking] grading rejected", { attemptId, err });
      return "grading";
    }
    console.error("[speaking] grading failed (unknown)", { attemptId, err });
    return "unknown";
  }
}

function speakingResultsUrl(
  attemptId: string,
  outcome: SpeakingGradeOutcome,
): string {
  if (outcome === "ok") return `/results/${attemptId}`;
  return `/results/${attemptId}?error=${outcome}`;
}

// Idempotent grading step. Loads the persisted transcripts + recording
// duration + test content, computes the audio features on the fly, calls
// the grader, and writes the Grade row in a transaction with the
// Attempt.status → Graded flip. Returns silently if Grade already exists.
async function runSpeakingGrading(
  ctx: OrgContext,
  attemptId: string,
): Promise<void> {
  const db = withOrg(ctx);

  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      user_id: true,
      section: true,
      status: true,
      test: { select: { body_json: true, section: true } },
      recording: { select: { duration_sec: true } },
      grade: { select: { id: true } },
      answers: {
        select: {
          question_id: true,
          response: true,
          question: { select: { type: true } },
        },
      },
    },
  });
  if (!attempt || attempt.user_id !== ctx.user_id) {
    throw new Error("Attempt not found.");
  }
  if (attempt.section !== "Speaking" || attempt.test.section !== "Speaking") {
    throw new Error("Not a Speaking attempt.");
  }
  if (attempt.grade) {
    // Already graded — nothing to do.
    return;
  }
  if (attempt.status !== "Submitted") {
    throw new Error(`Cannot grade attempt with status ${attempt.status}.`);
  }
  if (!attempt.recording) {
    throw new Error("Cannot grade an attempt without a recording.");
  }

  const content = parseSpeakingContent(attempt.test.body_json);
  if (!content) {
    throw new Error("Test content is malformed.");
  }

  // Collect per-part transcripts + concatenated segments from the Answer
  // rows. `Answer.response.segments` was written at transcribe-time, so
  // we can re-derive audio features without re-running Whisper.
  const transcripts: Record<SpeakingPartKey, string> = {
    part1: "",
    part2: "",
    part3: "",
  };
  const allSegments: TranscriptSegment[] = [];
  const partsCovered: SpeakingPartKey[] = [];
  for (const a of attempt.answers) {
    const text = readAnswerText(a.response);
    const segments = readAnswerSegments(a.response);
    let part: SpeakingPartKey | null = null;
    if (a.question.type === "speaking-part-1") part = "part1";
    else if (a.question.type === "speaking-part-2-cue") part = "part2";
    else if (a.question.type === "speaking-part-3") part = "part3";
    if (part) {
      transcripts[part] = text;
      if (text.trim().length > 0) partsCovered.push(part);
    }
    allSegments.push(...segments);
  }

  const features = extractAudioFeatures({
    segments: allSegments,
    duration_sec: attempt.recording.duration_sec,
  });

  const result = await speakingGrader.grade({
    ctx,
    transcripts,
    audioFeatures: features,
    partsCovered,
    testContent: {
      part2_cue_card: content.part2.cue_card_topic,
      part3_theme: content.part3.theme,
    },
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

// ─── regradeSpeakingAttempt ──────────────────────────────────────────────
//
// Form action wired to the "Try grading again" button on the results page.
// Re-runs grading for a Submitted-but-not-Graded attempt and redirects
// back to the results page with an outcome tag.

export async function regradeSpeakingAttempt(
  formData: FormData,
): Promise<void> {
  const ctx = await requireOrgContext();
  const attemptId = formData.get("attemptId");
  if (typeof attemptId !== "string" || attemptId.length === 0) {
    throw new Error("Missing attemptId.");
  }
  const outcome = await tryGradeSpeaking(ctx, attemptId);
  redirect(speakingResultsUrl(attemptId, outcome));
}

// ─── Voice rotation (Phase 5) ────────────────────────────────────────────
//
// The OpenAI Realtime GA API ships several voices that differ in timbre,
// age, and perceived accent. We pick one per attempt with a tiny stable
// hash so the examiner doesn't always sound identical, while a given
// attempt stays consistent across reconnects.

const REALTIME_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "sage",
  "verse",
] as const;

function voiceForAttempt(attemptId: string): string {
  let hash = 0;
  for (let i = 0; i < attemptId.length; i++) {
    hash = (hash * 31 + attemptId.charCodeAt(i)) >>> 0;
  }
  return REALTIME_VOICES[hash % REALTIME_VOICES.length]!;
}

// ─── Answer-payload helpers ──────────────────────────────────────────────

function readAnswerText(raw: unknown): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as { text?: unknown };
    if (typeof obj.text === "string") return obj.text;
  }
  return "";
}

function readAnswerSegments(raw: unknown): TranscriptSegment[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const obj = raw as { segments?: unknown };
  if (!Array.isArray(obj.segments)) return [];
  const out: TranscriptSegment[] = [];
  for (const s of obj.segments) {
    if (s && typeof s === "object" && !Array.isArray(s)) {
      const seg = s as { start?: unknown; end?: unknown; text?: unknown };
      if (
        typeof seg.start === "number" &&
        typeof seg.end === "number" &&
        typeof seg.text === "string"
      ) {
        out.push({ start: seg.start, end: seg.end, text: seg.text });
      }
    }
  }
  return out;
}
