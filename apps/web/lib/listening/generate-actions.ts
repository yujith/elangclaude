"use server";

// SuperAdmin-only entry point for `listening-generate`.
//
// Mirrors apps/web/lib/reading/generate-actions.ts. The Phase 5 moderation
// console will drive this; until then a SuperAdmin invokes via the
// `/dev/login` + `/dev/generate-listening` shim.
//
// Authorization is strict: requireRole("SuperAdmin") throws ForbiddenError
// to anyone else. The SuperAdmin's home org bears the (small) generation
// quota cost — actual TTS synth happens later, at approval time.

import { redirect } from "next/navigation";
import { prisma } from "@elc/db/client";
import {
  GenerationShapeError,
  GenerationValidationError,
  QuotaExceededError,
  listeningGenerator,
  persistGeneratedListening,
  type ListeningValidationIssue,
} from "@elc/ai";
import { requireRole } from "@/lib/auth/context";

export type GenerateListeningOutcome =
  | { ok: true; testId: string; attempts: number; model: string }
  | {
      ok: false;
      error: "quota" | "schema" | "validation" | "unknown";
      validationIssues?: ListeningValidationIssue[];
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

export async function generateListeningTest(input: {
  track: "Academic" | "GeneralTraining";
  difficulty: number;
  topicHint?: string;
}): Promise<GenerateListeningOutcome> {
  const ctx = await requireRole("SuperAdmin");
  try {
    const result = await listeningGenerator.generate({
      ctx,
      track: input.track,
      difficulty: input.difficulty,
      topicHint: input.topicHint,
    });
    const persisted = await persistGeneratedListening(prisma, result.value, {
      generatedById: ctx.user_id,
      difficulty: input.difficulty,
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
      purpose: "listening-generate" as const,
      track: input.track,
      difficulty: input.difficulty,
    };
    if (err instanceof QuotaExceededError) return { ok: false, error: "quota" };
    if (err instanceof GenerationShapeError) {
      console.error(
        "[listening-generate] schema rejection — model output did not parse",
        { ...tag, issues: err.issues },
      );
      return { ok: false, error: "schema" };
    }
    if (err instanceof GenerationValidationError) {
      const issues = Array.isArray(err.issues)
        ? (err.issues as ListeningValidationIssue[])
        : [];
      console.error("[listening-generate] validation rejection", {
        ...tag,
        issues,
      });
      return { ok: false, error: "validation", validationIssues: issues };
    }
    console.error("[listening-generate] unknown failure", { ...tag, err });
    return { ok: false, error: "unknown" };
  }
}

export async function generateListeningTestForm(
  formData: FormData,
): Promise<void> {
  const track = parseTrack(formData.get("track"));
  if (!track) throw new Error("Missing or invalid track.");
  const difficulty = parseDifficulty(formData.get("difficulty"));
  if (difficulty === null) throw new Error("Missing or invalid difficulty.");
  const topicRaw = formData.get("topicHint");
  const topicHint =
    typeof topicRaw === "string" && topicRaw.trim().length > 0
      ? topicRaw.trim()
      : undefined;

  const returnToRaw = formData.get("returnTo");
  const returnTo =
    typeof returnToRaw === "string" &&
    (returnToRaw === "/content/listening" ||
      returnToRaw === "/dev/generate-listening")
      ? returnToRaw
      : "/dev/generate-listening";

  const outcome = await generateListeningTest({ track, difficulty, topicHint });
  if (!outcome.ok) {
    const params = new URLSearchParams({ generate_error: outcome.error });
    if (outcome.error === "validation" && outcome.validationIssues) {
      const codes = outcome.validationIssues
        .map((i) => i.code)
        .filter((c, idx, arr) => arr.indexOf(c) === idx)
        .join(",");
      if (codes.length > 0) params.set("validation_issues", codes);
    }
    redirect(`${returnTo}?${params.toString()}`);
  }
  redirect(`${returnTo}?generated=${outcome.testId}`);
}
