// TTS orchestration for Listening tests.
//
// Given a Listening test id, walks the parsed body_json, plans synth
// jobs for every segment without an audio_clip, drives the cache layer
// over the jobs, and persists the updated body_json. Returns counts so
// callers can surface success/failure totals.
//
// Shared by the SuperAdmin moderation actions (approve / re-synthesise)
// and the ADR-0024 automation publish gate — extracted from
// moderation-actions.ts so the cron path can reuse it without going
// through a server action.
//
// Synchronous — TTS for ~30 segments takes 20–40 seconds. We accept the
// latency because it runs once per Test, behind an explicit SuperAdmin
// click or a scheduled automation run. If approval volume grows past a
// few sections per day we move this to a background queue (Phase 7
// follow-up).

import {
  attachSynthesizedClips,
  parseListeningContent,
  planSynthesisJobs,
  ttsCache,
  type SynthesizedClip,
} from "@elc/ai";
import { Prisma, withSuperAdminContext } from "@elc/db";
import type { OrgContext } from "@elc/db";

export type SynthRunResult = {
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

export async function synthesiseListeningClips(
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
