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
  ProviderError,
  QuotaExceededError,
  listeningGenerator,
  persistGeneratedListening,
  type ListeningValidationIssue,
} from "@elc/ai";
import { requireRole } from "@/lib/auth/context";
import { pickTopicSeed } from "@/lib/listening/topic-seed";

export type GenerateListeningOutcome =
  | {
      ok: true;
      testId: string;
      attempts: number;
      model: string;
      // 0 in the common case; non-zero when the cleaner removed 1-2
      // ungrounded questions before persistence. Surfaced on the
      // moderation page so the operator can re-roll if the trimmed
      // section is too small for their needs.
      droppedQuestions: number;
    }
  | {
      ok: false;
      error: "quota" | "schema" | "validation" | "provider" | "unknown";
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

// Topic seed pool lives in lib/listening/topic-seed.ts (shared with the
// ADR-0024 automation runner).

export async function generateListeningTest(input: {
  track: "Academic" | "GeneralTraining";
  difficulty: number;
  topicHint?: string;
}): Promise<GenerateListeningOutcome> {
  const ctx = await requireRole("SuperAdmin");
  // If the SuperAdmin didn't pass a topic hint, seed one ourselves
  // from the curated pool — otherwise the model keeps drifting back
  // to its anchor topics from the prompt examples. The fresh hint in
  // the user turn forces a different scenario each generation.
  const effectiveTopicHint =
    input.topicHint && input.topicHint.trim().length > 0
      ? input.topicHint.trim()
      : pickTopicSeed();
  try {
    const result = await listeningGenerator.generate({
      ctx,
      track: input.track,
      difficulty: input.difficulty,
      topicHint: effectiveTopicHint,
    });
    const persisted = await persistGeneratedListening(prisma, result.value, {
      generatedById: ctx.user_id,
      difficulty: input.difficulty,
      generatedModel: result.model,
    });
    if (result.droppedQuestions.length > 0) {
      console.warn("[listening-generate] cleaner dropped questions", {
        org_id: ctx.org_id,
        user_id: ctx.user_id,
        test_id: persisted.testId,
        dropped: result.droppedQuestions,
        kept: result.value.questions.length,
      });
    }
    console.info("[listening-generate] success", {
      test_id: persisted.testId,
      track: input.track,
      difficulty: input.difficulty,
      topic_hint_provided_by_user: Boolean(
        input.topicHint && input.topicHint.trim().length > 0,
      ),
      effective_topic_hint: effectiveTopicHint,
      questions_kept: result.value.questions.length,
      dropped: result.droppedQuestions.length,
    });
    return {
      ok: true,
      testId: persisted.testId,
      attempts: result.attempts,
      model: result.model,
      droppedQuestions: result.droppedQuestions.length,
    };
  } catch (err) {
    const tag = {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      purpose: "listening-generate" as const,
      track: input.track,
      difficulty: input.difficulty,
      topicHint: effectiveTopicHint,
      topicHintProvidedByUser: Boolean(
        input.topicHint && input.topicHint.trim().length > 0,
      ),
    };
    if (err instanceof QuotaExceededError) return { ok: false, error: "quota" };
    if (err instanceof ProviderError) {
      console.error("[listening-generate] provider failure", { ...tag, err });
      return { ok: false, error: "provider" };
    }
    if (err instanceof GenerationShapeError) {
      // Log the issue paths + a truncated snapshot of the raw response so
      // the SuperAdmin can see WHERE the model deviated, not just the
      // generic shape error. Truncate aggressively — a full 8000-token
      // response would drown the console.
      const issues = Array.isArray(err.issues)
        ? (err.issues as { path?: unknown[]; message?: string; code?: string }[]).map(
            (i) => ({
              code: i.code,
              path: i.path,
              message: i.message,
            }),
          )
        : err.issues;
      console.error(
        "[listening-generate] schema rejection — model output did not parse",
        {
          ...tag,
          issues,
          raw_preview:
            typeof err.raw === "string"
              ? err.raw.slice(0, 800) +
                (err.raw.length > 800 ? `\n…[truncated ${err.raw.length - 800} chars]` : "")
              : null,
        },
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
  const params = new URLSearchParams({ generated: outcome.testId });
  if (outcome.droppedQuestions > 0) {
    params.set("dropped", String(outcome.droppedQuestions));
  }
  redirect(`${returnTo}?${params.toString()}`);
}
