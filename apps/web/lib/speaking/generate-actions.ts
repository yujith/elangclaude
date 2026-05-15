"use server";

// SuperAdmin-only entry point for `speaking-cue-generate`.
//
// Mirrors lib/writing/generate-actions.ts. Authorization is strict:
// requireRole("SuperAdmin") throws ForbiddenError to anyone else. The
// SuperAdmin's home org bears the (cheap, OpenRouter-tier) quota cost.
//
// A Speaking test is one Test row + three thin Question anchors, landing as
// PendingReview. The moderation console promotes it to Approved. IELTS
// Speaking content is track-agnostic (ADR 0006 D3) — the track is one
// dropdown, kept only as a catalog tag.

import { redirect } from "next/navigation";
import { Prisma, withSuperAdminContext } from "@elc/db";
import { prisma } from "@elc/db/client";
import {
  GenerationShapeError,
  GenerationValidationError,
  QuotaExceededError,
  persistGeneratedSpeaking,
  speakingGenerator,
  type SpeakingValidationIssue,
} from "@elc/ai";
import { requireRole } from "@/lib/auth/context";

export type GenerateSpeakingOutcome =
  | { ok: true; testId: string; attempts: number; model: string }
  | {
      ok: false;
      error: "quota" | "schema" | "validation" | "bad_request" | "unknown";
      validationIssues?: SpeakingValidationIssue[];
    };

function parseTrack(raw: unknown): "Academic" | "GeneralTraining" | null {
  if (raw === "Academic" || raw === "GeneralTraining") return raw;
  return null;
}

function parseDifficulty(raw: unknown): number | null {
  const n =
    typeof raw === "string"
      ? Number.parseInt(raw, 10)
      : typeof raw === "number"
        ? raw
        : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

// Programmatic entry — called from the form-action wrapper below and from
// tests. Returns a typed outcome so the caller can render the failure path
// without throwing.
export async function generateSpeakingTest(input: {
  track: "Academic" | "GeneralTraining";
  difficulty: number;
  topicHint?: string;
}): Promise<GenerateSpeakingOutcome> {
  const ctx = await requireRole("SuperAdmin");
  try {
    const result = await speakingGenerator.generate({
      ctx,
      track: input.track,
      difficulty: input.difficulty,
      topicHint: input.topicHint,
    });
    const persisted = await persistGeneratedSpeaking(prisma, result.value, {
      generatedById: ctx.user_id,
      difficulty: input.difficulty,
    });
    // ActivityLog is tenant-scoped — log under the SuperAdmin's home org,
    // which is the org bearing the generation cost.
    const db = withSuperAdminContext(ctx);
    await db.activityLog.create({
      data: {
        org_id: ctx.org_id,
        user_id: ctx.user_id,
        action: "content.speaking.generated",
        metadata: {
          test_id: persisted.testId,
          track: result.value.track,
          difficulty: input.difficulty,
          topic_domain: result.value.topic_domain,
          model: result.model,
          attempts: result.attempts,
        } as Prisma.InputJsonValue,
      },
    });
    return {
      ok: true,
      testId: persisted.testId,
      attempts: result.attempts,
      model: result.model,
    };
  } catch (err) {
    const tag = {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      purpose: "speaking-cue-generate" as const,
      track: input.track,
      difficulty: input.difficulty,
    };
    if (err instanceof QuotaExceededError) return { ok: false, error: "quota" };
    if (err instanceof GenerationShapeError) {
      // Include a truncated `raw` so the failing field is visible without a
      // second round-trip. err.raw is the post-retry model output.
      const raw =
        typeof err.raw === "string"
          ? err.raw.length > 1500
            ? err.raw.slice(0, 1500) + "…[truncated]"
            : err.raw
          : "(no raw)";
      console.error(
        "[speaking-cue-generate] schema rejection — model output did not parse",
        { ...tag, issues: err.issues, raw },
      );
      return { ok: false, error: "schema" };
    }
    if (err instanceof GenerationValidationError) {
      const issues = Array.isArray(err.issues)
        ? (err.issues as SpeakingValidationIssue[])
        : [];
      console.error("[speaking-cue-generate] validation rejection", {
        ...tag,
        issues,
      });
      return { ok: false, error: "validation", validationIssues: issues };
    }
    console.error("[speaking-cue-generate] unknown failure", { ...tag, err });
    return { ok: false, error: "unknown" };
  }
}

// Form action — wraps the programmatic entry for HTML form posts from the
// moderation console.
export async function generateSpeakingTestForm(
  formData: FormData,
): Promise<void> {
  const track = parseTrack(formData.get("track"));
  const difficulty = parseDifficulty(formData.get("difficulty"));

  if (!track || difficulty === null) {
    redirect("/content/speaking?generate_error=bad_request");
  }

  const topicRaw = formData.get("topicHint");
  const topicHint =
    typeof topicRaw === "string" && topicRaw.trim().length > 0
      ? topicRaw.trim()
      : undefined;

  const outcome = await generateSpeakingTest({ track, difficulty, topicHint });
  if (!outcome.ok) {
    const params = new URLSearchParams({ generate_error: outcome.error });
    if (outcome.error === "validation" && outcome.validationIssues) {
      const codes = outcome.validationIssues
        .map((i) => i.code)
        .filter((c, idx, arr) => arr.indexOf(c) === idx)
        .join(",");
      if (codes.length > 0) params.set("validation_issues", codes);
    }
    redirect(`/content/speaking?${params.toString()}`);
  }
  redirect(`/content/speaking?generated=${outcome.testId}`);
}
