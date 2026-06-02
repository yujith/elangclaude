"use server";

// SuperAdmin-only entry point for `reading-generate`.
//
// Phase 5 ships the pipeline + this action; the UI lands in Phase 6
// alongside the moderation console. Until then a SuperAdmin invokes
// this action via the `/dev/login` shim + a form (or curl) targeting it.
//
// Authorization is strict: requireRole("SuperAdmin") throws ForbiddenError
// to anyone else. Even an OrgAdmin cannot trigger generation today — the
// SuperAdmin's home org is the one bearing the quota cost (see ADR 0004
// D4).

import { redirect } from "next/navigation";
import { prisma } from "@elc/db/client";
import {
  GenerationShapeError,
  GenerationValidationError,
  ProviderError,
  QuotaExceededError,
  persistGeneratedReading,
  readingGenerator,
  type GenerationValidationIssue,
} from "@elc/ai";
import { requireRole } from "@/lib/auth/context";

export type GenerateReadingOutcome =
  | { ok: true; testId: string; attempts: number; model: string }
  | {
      ok: false;
      error: "quota" | "schema" | "validation" | "provider" | "unknown";
      // Populated for "validation" failures so the caller can render the
      // stable issue codes (e.g. "passage.too-short") and a re-roll hint.
      validationIssues?: GenerationValidationIssue[];
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

// Programmatic entry — called from server-side code (Phase 6 UI, tests,
// the form-action wrapper below). Returns a typed outcome so the caller
// can render the failure path without throwing.
export async function generateReadingTest(input: {
  track: "Academic" | "GeneralTraining";
  difficulty: number;
  topicHint?: string;
}): Promise<GenerateReadingOutcome> {
  const ctx = await requireRole("SuperAdmin");
  try {
    const result = await readingGenerator.generate({
      ctx,
      track: input.track,
      difficulty: input.difficulty,
      topicHint: input.topicHint,
    });
    const persisted = await persistGeneratedReading(prisma, result.value, {
      generatedById: ctx.user_id,
      difficulty: input.difficulty,
      generatedModel: result.model,
    });
    return {
      ok: true,
      testId: persisted.testId,
      attempts: result.attempts,
      model: result.model,
    };
  } catch (err) {
    // Every log line carries org_id + user_id + purpose so cost-dashboard
    // and ActivityLog correlation is trivial. Generation failures are
    // SuperAdmin-only so the tags don't leak anything sensitive, but the
    // hygiene convention applies uniformly.
    const tag = {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      purpose: "reading-generate" as const,
      track: input.track,
      difficulty: input.difficulty,
    };
    if (err instanceof QuotaExceededError) return { ok: false, error: "quota" };
    if (err instanceof ProviderError) {
      console.error("[reading-generate] provider failure", { ...tag, err });
      return { ok: false, error: "provider" };
    }
    if (err instanceof GenerationShapeError) {
      console.error(
        "[reading-generate] schema rejection — model output did not parse",
        { ...tag, issues: err.issues },
      );
      return { ok: false, error: "schema" };
    }
    if (err instanceof GenerationValidationError) {
      const issues = Array.isArray(err.issues)
        ? (err.issues as GenerationValidationIssue[])
        : [];
      console.error("[reading-generate] validation rejection", {
        ...tag,
        issues,
      });
      return { ok: false, error: "validation", validationIssues: issues };
    }
    console.error("[reading-generate] unknown failure", { ...tag, err });
    return { ok: false, error: "unknown" };
  }
}

// Form action — wraps the programmatic entry for HTML form posts. Phase 6
// will drive this from the real moderation console; until then we redirect
// back to the dev shim at /dev/generate-reading where the result panel
// renders the passage + questions for inspection. Landing on the learner
// picker would be misleading: PendingReview tests are filtered out of it.
export async function generateReadingTestForm(formData: FormData): Promise<void> {
  const track = parseTrack(formData.get("track"));
  if (!track) throw new Error("Missing or invalid track.");
  const difficulty = parseDifficulty(formData.get("difficulty"));
  if (difficulty === null) throw new Error("Missing or invalid difficulty.");
  const topicRaw = formData.get("topicHint");
  const topicHint =
    typeof topicRaw === "string" && topicRaw.trim().length > 0
      ? topicRaw.trim()
      : undefined;

  // The form can be embedded on multiple SuperAdmin surfaces; the
  // `returnTo` hidden field lets each surface specify where to land. We
  // restrict to two known prefixes to avoid open-redirect risk.
  const returnToRaw = formData.get("returnTo");
  const returnTo =
    typeof returnToRaw === "string" &&
    (returnToRaw === "/content/reading" || returnToRaw === "/dev/generate-reading")
      ? returnToRaw
      : "/content/reading";

  const outcome = await generateReadingTest({ track, difficulty, topicHint });
  if (!outcome.ok) {
    const params = new URLSearchParams({ generate_error: outcome.error });
    if (outcome.error === "validation" && outcome.validationIssues) {
      // Stable issue codes (e.g. "passage.too-short") are short and finite —
      // safe to send through the URL. The free-text `message` is not.
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
