"use server";

// SuperAdmin-only moderation actions for Listening tests.
//
// Test/Question are global models — withOrg() would pass them through
// unscoped anyway — so we use withSuperAdminContext() per the multi-
// tenancy rule. NEVER mix the two helpers in the same function.
//
// Approve runs TTS synth for every speech / narration segment in line
// with the action — it is a synchronous orchestration that can take
// 20–40 seconds for a freshly-generated section. A failed synth on
// one segment does NOT roll the approval back; the test ships with the
// successful clips and the SuperAdmin can re-synthesise from the
// review page.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  attachSynthesizedClips,
  parseListeningContent,
  planSynthesisJobs,
  ttsCache,
  type SynthesizedClip,
} from "@elc/ai";
import { Prisma, withSuperAdminContext } from "@elc/db";
import type { OrgContext } from "@elc/db";
import { requireRole } from "@/lib/auth/context";

export type ListeningModerationResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "wrong_state" | "wrong_section" };

async function loadTestForModeration(testId: string): Promise<{
  id: string;
  status: "Draft" | "PendingReview" | "Approved" | "Rejected";
  section: "Reading" | "Listening" | "Writing" | "Speaking";
} | null> {
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);
  const test = await db.test.findUnique({
    where: { id: testId },
    select: { id: true, status: true, section: true },
  });
  return test;
}

export async function approveListeningTest(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = formData.get("testId");
  if (typeof testId !== "string" || testId.length === 0) {
    throw new Error("Missing testId.");
  }
  const db = withSuperAdminContext(ctx);
  const test = await loadTestForModeration(testId);
  if (!test) throw new Error("Test not found.");
  if (test.section !== "Listening") {
    throw new Error("Only Listening tests can be moderated here.");
  }
  if (test.status !== "PendingReview") {
    if (test.status === "Approved") {
      redirect(`/content/listening/${testId}?approved=1`);
    }
    throw new Error(`Cannot approve a ${test.status} test.`);
  }

  // Flip status FIRST. If the synth run partially fails the test is
  // still approved (with missing clips) — the alternative ("roll back
  // approval on any synth failure") leaves the SuperAdmin stuck in a
  // loop where one flaky clip blocks the whole release.
  await db.test.update({
    where: { id: test.id },
    data: { status: "Approved", approved_by: ctx.user_id },
  });
  await db.activityLog.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      action: "content.listening.approved",
      metadata: { test_id: test.id } as Prisma.InputJsonValue,
    },
  });

  const synth = await synthesiseListeningClips(ctx, testId);

  revalidatePath("/content/listening");
  revalidatePath(`/content/listening/${testId}`);
  if (synth.failures > 0) {
    // Drop the SuperAdmin on the review page, not back at the queue —
    // the queue page lists pending tests only, so a partial-fail approve
    // used to dead-end with no way to reach the re-synth form. The review
    // page hosts the form and now renders the same hint banner.
    const hint = synth.errorSamples.join(" || ");
    const hintParam = hint
      ? `&synth_hint=${encodeURIComponent(hint)}`
      : "";
    redirect(
      `/content/listening/${test.id}?approved=1&synth_error=${synth.failures}-of-${synth.attempted}-failed${hintParam}`,
    );
  }
  redirect("/content/listening?approved=" + test.id);
}

// Re-runs TTS synth without changing approval status. Used by the
// review page's "Re-synthesise audio" form when an earlier approve
// partially failed.
export async function resynthesiseListeningAudio(
  formData: FormData,
): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = formData.get("testId");
  if (typeof testId !== "string" || testId.length === 0) {
    throw new Error("Missing testId.");
  }
  const synth = await synthesiseListeningClips(ctx, testId);
  revalidatePath(`/content/listening/${testId}`);
  if (synth.failures > 0) {
    const hint = synth.errorSamples.join(" || ");
    const hintParam = hint
      ? `&synth_hint=${encodeURIComponent(hint)}`
      : "";
    redirect(
      `/content/listening/${testId}?synth_error=${synth.failures}-of-${synth.attempted}-failed${hintParam}`,
    );
  }
  redirect(`/content/listening/${testId}?synth_ok=${synth.synthed}-of-${synth.attempted}`);
}

export async function rejectListeningTest(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = formData.get("testId");
  if (typeof testId !== "string" || testId.length === 0) {
    throw new Error("Missing testId.");
  }
  const reasonRaw = formData.get("reason");
  const reason =
    typeof reasonRaw === "string" && reasonRaw.trim().length > 0
      ? reasonRaw.trim().slice(0, 500)
      : undefined;

  const db = withSuperAdminContext(ctx);
  const test = await loadTestForModeration(testId);
  if (!test) throw new Error("Test not found.");
  if (test.section !== "Listening") {
    throw new Error("Only Listening tests can be moderated here.");
  }
  if (test.status !== "PendingReview") {
    if (test.status === "Rejected") {
      redirect(`/content/listening?rejected=${testId}`);
    }
    throw new Error(`Cannot reject a ${test.status} test.`);
  }

  await db.test.update({
    where: { id: test.id },
    data: { status: "Rejected" },
  });
  await db.activityLog.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      action: "content.listening.rejected",
      metadata: {
        test_id: test.id,
        reason: reason ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/content/listening");
  redirect("/content/listening?rejected=" + test.id);
}

// ─── TTS orchestration ──────────────────────────────────────────────────
//
// Given a Listening test id, walks the parsed body_json, plans synth
// jobs for every segment without an audio_clip, drives the cache layer
// over the jobs, and persists the updated body_json. Returns counts so
// the action can surface success/failure totals to the SuperAdmin.
//
// Synchronous — TTS for ~30 segments takes 20–40 seconds. We accept the
// latency in v1 because it runs once per Test, behind an explicit
// SuperAdmin click. If approval volume grows past a few sections per
// day we move this to a background queue (Phase 7 follow-up).

type SynthRunResult = {
  attempted: number;
  synthed: number;
  cached: number;
  failures: number;
  // Up to ~3 distinct failure fingerprints (one per unique voice_id × HTTP
  // status). Surfaced in the redirect so the SuperAdmin sees WHY synth
  // failed without grepping the server console — a 72%-fail "voice not
  // found" run looks identical to a 72%-fail "quota exhausted" run in the
  // counts alone.
  errorSamples: string[];
};

// Pull a compact, single-line message out of whatever the TTS layer threw.
// ProviderError messages look like:
//   `Upstream provider "elevenlabs" failed: ElevenLabs 404: {"detail":...}`
// Trim the prefix and clamp so the result fits in a URL banner.
function describeSynthError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message
      .replace(/^Upstream provider "elevenlabs" failed:\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    return msg.length > 220 ? `${msg.slice(0, 217)}…` : msg;
  }
  return "unknown error";
}

async function synthesiseListeningClips(
  ctx: OrgContext,
  testId: string,
): Promise<SynthRunResult> {
  const db = withSuperAdminContext(ctx);
  const test = await db.test.findUnique({
    where: { id: testId },
    select: { id: true, section: true, body_json: true },
  });
  if (!test || test.section !== "Listening") {
    throw new Error("Test not found.");
  }
  const content = parseListeningContent(test.body_json);
  if (!content) {
    throw new Error("Listening body_json could not be parsed.");
  }
  const jobs = planSynthesisJobs(content, testId);
  if (jobs.length === 0) {
    return { attempted: 0, synthed: 0, cached: 0, failures: 0, errorSamples: [] };
  }

  const clips: SynthesizedClip[] = [];
  let synthed = 0;
  let cached = 0;
  let failures = 0;
  // Dedupe samples by (voice_id, http-status-or-prefix) so 37 identical
  // "voice not found" failures collapse to a single banner line.
  const seenFingerprints = new Set<string>();
  const errorSamples: string[] = [];
  for (const job of jobs) {
    try {
      const result = await ttsCache.synthesizeAndCache({
        ctx,
        text: job.text,
        voice_id: job.voice_id,
        format: job.format,
      });
      if (result.cache === "hit") cached += 1;
      else synthed += 1;
      clips.push({
        part_index: job.part_index,
        segment_index: job.segment_index,
        clip: {
          storage_key: result.storage_key,
          duration_sec: result.duration_sec,
          sha256: result.sha256,
          format: result.format,
        },
      });
    } catch (err) {
      failures += 1;
      const description = describeSynthError(err);
      console.error("[listening-tts] synth failed", {
        org_id: ctx.org_id,
        user_id: ctx.user_id,
        test_id: testId,
        part_index: job.part_index,
        segment_index: job.segment_index,
        voice_id: job.voice_id,
        err,
      });
      const httpStatus = /\b(\d{3})\b/.exec(description)?.[1] ?? "ERR";
      const fingerprint = `${job.voice_id}|${httpStatus}`;
      if (!seenFingerprints.has(fingerprint) && errorSamples.length < 3) {
        seenFingerprints.add(fingerprint);
        errorSamples.push(`voice ${job.voice_id} → ${description}`);
      }
    }
  }

  // Even on partial failure, persist the clips we DID get. The next
  // re-synth run only re-attempts the failed ones (planSynthesisJobs
  // skips segments with audio_clip already set).
  if (clips.length > 0) {
    const next = attachSynthesizedClips(content, clips);
    await db.test.update({
      where: { id: testId },
      data: {
        body_json: next as unknown as Prisma.InputJsonValue,
      },
    });
  }

  return { attempted: jobs.length, synthed, cached, failures, errorSamples };
}
