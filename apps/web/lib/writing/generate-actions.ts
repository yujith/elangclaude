"use server";

// SuperAdmin-only entry point for `writing-generate`.
//
// Mirrors lib/reading/generate-actions.ts. Authorization is strict:
// requireRole("SuperAdmin") throws ForbiddenError to anyone else. The
// SuperAdmin's home org bears the (cheap, OpenRouter-tier) quota cost.
//
// A Writing test is one Test row + one Question row, landing as
// PendingReview. The moderation console promotes it to Approved.

import { redirect } from "next/navigation";
import { Prisma, SYSTEM_ORG_ID, withSuperAdminContext } from "@elc/db";
import { prisma } from "@elc/db/client";
import {
  GenerationShapeError,
  GenerationValidationError,
  QuotaExceededError,
  persistGeneratedWriting,
  writingGenerator,
  type WritingTaskKind,
  type WritingValidationIssue,
} from "@elc/ai";
import { requireRole } from "@/lib/auth/context";

export type GenerateWritingOutcome =
  | { ok: true; testId: string; attempts: number; model: string }
  | {
      ok: false;
      error: "quota" | "schema" | "validation" | "bad_request" | "unknown";
      validationIssues?: WritingValidationIssue[];
    };

const TASK_KINDS: ReadonlySet<string> = new Set([
  "writing-task-1-academic",
  "writing-task-1-general",
  "writing-task-2",
]);

function parseTaskKind(raw: unknown): WritingTaskKind | null {
  if (typeof raw === "string" && TASK_KINDS.has(raw)) {
    return raw as WritingTaskKind;
  }
  return null;
}

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

// Programmatic entry — called from the form-action wrapper below and
// from tests. Returns a typed outcome so the caller can render the
// failure path without throwing.
export async function generateWritingTest(input: {
  taskKind: WritingTaskKind;
  // Required for writing-task-2; ignored for the two Task 1 kinds.
  track?: "Academic" | "GeneralTraining";
  difficulty: number;
  topicHint?: string;
}): Promise<GenerateWritingOutcome> {
  const ctx = await requireRole("SuperAdmin");
  try {
    const result = await writingGenerator.generate({
      ctx,
      taskKind: input.taskKind,
      track: input.track,
      difficulty: input.difficulty,
      topicHint: input.topicHint,
    });
    const persisted = await persistGeneratedWriting(prisma, result.value, {
      generatedById: ctx.user_id,
      difficulty: input.difficulty,
    });
    // ActivityLog is tenant-scoped — super-level events live under the
    // singleton SYSTEM_ORG_ID so customer OrgAdmin views never see them.
    const db = withSuperAdminContext(ctx);
    await db.activityLog.create({
      data: {
        org_id: SYSTEM_ORG_ID,
        user_id: ctx.user_id,
        action: "content.writing.generated",
        metadata: {
          test_id: persisted.testId,
          task_kind: input.taskKind,
          track: result.value.track,
          difficulty: input.difficulty,
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
      purpose: "writing-generate" as const,
      task_kind: input.taskKind,
      difficulty: input.difficulty,
    };
    if (err instanceof QuotaExceededError) return { ok: false, error: "quota" };
    if (err instanceof GenerationShapeError) {
      console.error(
        "[writing-generate] schema rejection — model output did not parse",
        { ...tag, issues: err.issues },
      );
      return { ok: false, error: "schema" };
    }
    if (err instanceof GenerationValidationError) {
      const issues = Array.isArray(err.issues)
        ? (err.issues as WritingValidationIssue[])
        : [];
      console.error("[writing-generate] validation rejection", {
        ...tag,
        issues,
      });
      return { ok: false, error: "validation", validationIssues: issues };
    }
    console.error("[writing-generate] unknown failure", { ...tag, err });
    return { ok: false, error: "unknown" };
  }
}

// Form action — wraps the programmatic entry for HTML form posts from
// the moderation console.
export async function generateWritingTestForm(
  formData: FormData,
): Promise<void> {
  const taskKind = parseTaskKind(formData.get("taskKind"));
  const difficulty = parseDifficulty(formData.get("difficulty"));

  if (!taskKind || difficulty === null) {
    redirect("/content/writing?generate_error=bad_request");
  }

  // Task 1 kinds imply their track; Task 2 needs an explicit one. The
  // generator enforces this too — we resolve it here so the form can
  // omit the track field for Task 1.
  let track: "Academic" | "GeneralTraining" | undefined;
  if (taskKind === "writing-task-1-academic") {
    track = "Academic";
  } else if (taskKind === "writing-task-1-general") {
    track = "GeneralTraining";
  } else {
    const parsed = parseTrack(formData.get("track"));
    if (!parsed) {
      redirect("/content/writing?generate_error=bad_request");
    }
    track = parsed;
  }

  const topicRaw = formData.get("topicHint");
  const topicHint =
    typeof topicRaw === "string" && topicRaw.trim().length > 0
      ? topicRaw.trim()
      : undefined;

  const outcome = await generateWritingTest({
    taskKind,
    track,
    difficulty,
    topicHint,
  });
  if (!outcome.ok) {
    const params = new URLSearchParams({ generate_error: outcome.error });
    if (outcome.error === "validation" && outcome.validationIssues) {
      const codes = outcome.validationIssues
        .map((i) => i.code)
        .filter((c, idx, arr) => arr.indexOf(c) === idx)
        .join(",");
      if (codes.length > 0) params.set("validation_issues", codes);
    }
    redirect(`/content/writing?${params.toString()}`);
  }
  redirect(`/content/writing?generated=${outcome.testId}`);
}
