// ADR-0024 automation runner — wires the @elc/ai orchestration engine to
// the real generators, reviewer, publish gate, and Prisma bookkeeping.
//
// Called from two places, both already authorised:
//   - /api/cron/content-generation (CRON_SECRET bearer) for scheduled runs
//   - the /content/automation "Run now" server action (requireRole SuperAdmin)
//
// Execution identity: runs act as the schedule's creator (or the acting
// SuperAdmin for manual runs) under the singleton SYSTEM org — gateway
// quota and AiCallLog cost land on SYSTEM_ORG_ID, never a customer org.
// Test/Question/GenerationRun* are global content-pool models, accessed
// via withSuperAdminContext(); the constructed context carries role
// SuperAdmin only after verifying the acting user still IS a live
// SuperAdmin (resolveActingSuperAdmin).

import {
  AUTOMATION_MAX_COUNT_PER_RUN,
  GenerationShapeError,
  GenerationValidationError,
  ProviderError,
  QuotaExceededError,
  contentReviewer,
  listeningGenerator,
  parseListeningContent,
  persistGeneratedListening,
  persistGeneratedReading,
  persistGeneratedSpeaking,
  persistGeneratedWriting,
  readingGenerator,
  runAutomationItem,
  speakingGenerator,
  summarizeRunOutcomes,
  writingGenerator,
  type AutomationGenerateResult,
  type AutomationItemDeps,
  type AutomationItemOutcome,
  type AutomationParams,
  type GenerationRevision,
  type ReviewSection,
} from "@elc/ai";
import type { WritingTaskKind } from "@elc/ai";
import { Prisma, SYSTEM_ORG_ID, withSuperAdminContext } from "@elc/db";
import type { OrgContext } from "@elc/db";
import { prisma } from "@elc/db/client";
import { synthesiseListeningClips } from "@/lib/listening/synth";
import { pickTopicSeed } from "@/lib/listening/topic-seed";
import { validateReadingReviewRecord } from "@/lib/reading/review-validation";
import { validateSpeakingReviewRecord } from "@/lib/speaking/review-validation";
import { validateWritingReviewRecord } from "@/lib/writing/review-validation";

const DB_SECTION: Record<
  ReviewSection,
  "Reading" | "Listening" | "Writing" | "Speaking"
> = {
  reading: "Reading",
  listening: "Listening",
  writing: "Writing",
  speaking: "Speaking",
};

// ─── Acting identity ──────────────────────────────────────────────────────

// A scheduled run executes as its creator. The creator must still be a
// live SuperAdmin — a demoted or deleted account must not keep powering
// automation. Returns null (run fails with a clear error) otherwise.
export async function resolveActingSuperAdmin(
  userId: string | null | undefined,
): Promise<OrgContext | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, deleted_at: true },
  });
  if (!user || user.role !== "SuperAdmin" || user.deleted_at !== null) {
    return null;
  }
  return { org_id: SYSTEM_ORG_ID, user_id: user.id, role: "SuperAdmin" };
}

// ─── Engine deps (real implementations) ───────────────────────────────────

function describeGenerationError(err: unknown): string {
  if (err instanceof GenerationShapeError) return "schema: output did not parse";
  if (err instanceof GenerationValidationError) {
    const issues = Array.isArray(err.issues)
      ? (err.issues as { code?: string }[])
          .map((i) => i.code)
          .filter(Boolean)
          .join(",")
      : "";
    return `validation: ${issues || "content rejected"}`;
  }
  if (err instanceof ProviderError) return `provider: ${err.message}`;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

async function generateAndPersist(args: {
  ctx: OrgContext;
  params: AutomationParams;
  revision?: GenerationRevision;
}): Promise<AutomationGenerateResult> {
  const { ctx, params, revision } = args;
  const db = withSuperAdminContext(ctx);
  try {
    switch (params.section) {
      case "reading": {
        const result = await readingGenerator.generate({
          ctx,
          track: params.track,
          difficulty: params.difficulty,
          topicHint: params.topicHint,
          revision,
        });
        const persisted = await persistGeneratedReading(db, result.value, {
          generatedById: ctx.user_id,
          difficulty: params.difficulty,
          generatedModel: result.model,
          part: params.track === "Academic" ? params.part : undefined,
        });
        return {
          ok: true,
          testId: persisted.testId,
          payload: result.value,
          responseText: JSON.stringify(result.value),
          model: result.model,
        };
      }
      case "listening": {
        const result = await listeningGenerator.generate({
          ctx,
          track: params.track,
          difficulty: params.difficulty,
          // Same anchor-topic defence as the manual generate action.
          topicHint: params.topicHint?.trim() || pickTopicSeed(),
          revision,
        });
        const persisted = await persistGeneratedListening(db, result.value, {
          generatedById: ctx.user_id,
          difficulty: params.difficulty,
          generatedModel: result.model,
        });
        return {
          ok: true,
          testId: persisted.testId,
          payload: result.value,
          responseText: JSON.stringify(result.value),
          model: result.model,
        };
      }
      case "writing": {
        if (!params.taskKind) {
          return { ok: false, error: "writing schedule missing task_kind" };
        }
        const result = await writingGenerator.generate({
          ctx,
          taskKind: params.taskKind as WritingTaskKind,
          track: params.track,
          difficulty: params.difficulty,
          topicHint: params.topicHint,
          revision,
        });
        const persisted = await persistGeneratedWriting(db, result.value, {
          generatedById: ctx.user_id,
          difficulty: params.difficulty,
          generatedModel: result.model,
        });
        return {
          ok: true,
          testId: persisted.testId,
          payload: result.value,
          responseText: JSON.stringify(result.value),
          model: result.model,
        };
      }
      case "speaking": {
        const result = await speakingGenerator.generate({
          ctx,
          track: params.track,
          difficulty: params.difficulty,
          topicHint: params.topicHint,
          revision,
        });
        const persisted = await persistGeneratedSpeaking(db, result.value, {
          generatedById: ctx.user_id,
          difficulty: params.difficulty,
          generatedModel: result.model,
        });
        return {
          ok: true,
          testId: persisted.testId,
          payload: result.value,
          responseText: JSON.stringify(result.value),
          model: result.model,
        };
      }
    }
    // Exhaustive switch above — this satisfies noImplicitReturns.
    throw new Error(`unknown section ${String(params.section)}`);
  } catch (err) {
    // Quota exhaustion must stop the whole batch — rethrow for the engine.
    if (err instanceof QuotaExceededError) throw err;
    console.error("[automation] generation failed", {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      section: params.section,
      track: params.track,
      difficulty: params.difficulty,
      err,
    });
    return { ok: false, error: describeGenerationError(err) };
  }
}

// Second contract gate before any status flip — the same gate the human
// approve actions run. Listening has no review-validation module; its
// renderer contract is parseListeningContent.
async function contractGate(
  ctx: OrgContext,
  section: ReviewSection,
  testId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = withSuperAdminContext(ctx);
  const test = await db.test.findUnique({
    where: { id: testId },
    select: {
      track: true,
      difficulty: true,
      status: true,
      body_json: true,
      questions: {
        select: {
          id: true,
          type: true,
          prompt: true,
          position: true,
          correct_answer: true,
          visual: true,
        },
        orderBy: { position: "asc" },
      },
    },
  });
  if (!test) return { ok: false, error: "test not found" };
  if (test.status !== "PendingReview") {
    return { ok: false, error: `unexpected status ${test.status}` };
  }

  switch (section) {
    case "reading": {
      const v = validateReadingReviewRecord(test);
      if (!v.ok) {
        return {
          ok: false,
          error: `contract(${v.reason}): ${v.issueCodes.join(",")}`,
        };
      }
      return { ok: true };
    }
    case "writing": {
      const question = test.questions[0];
      if (!question) return { ok: false, error: "contract: no question row" };
      const v = validateWritingReviewRecord({
        track: test.track,
        difficulty: test.difficulty,
        body_json: test.body_json,
        question,
      });
      if (!v.ok) {
        return {
          ok: false,
          error: `contract(${v.reason}): ${v.issueCodes.join(",")}`,
        };
      }
      return { ok: true };
    }
    case "speaking": {
      const v = validateSpeakingReviewRecord({
        track: test.track,
        difficulty: test.difficulty,
        body_json: test.body_json,
        questions: test.questions,
      });
      if (!v.ok) {
        return {
          ok: false,
          error: `contract(${v.reason}): ${v.issueCodes.join(",")}`,
        };
      }
      return { ok: true };
    }
    case "listening": {
      if (!parseListeningContent(test.body_json)) {
        return { ok: false, error: "contract: body_json does not parse" };
      }
      return { ok: true };
    }
  }
  // Exhaustive switch above — this satisfies noImplicitReturns.
  return { ok: false, error: `unknown section ${String(section)}` };
}

function clampForLog(text: string | null, max = 500): string | null {
  if (text === null) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function writeContentLog(
  ctx: OrgContext,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const db = withSuperAdminContext(ctx);
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}

function buildItemDeps(): AutomationItemDeps {
  return {
    generate: generateAndPersist,

    review: async ({ ctx, section, track, difficulty, payload }) => {
      const res = await contentReviewer.review({
        ctx,
        section,
        track,
        difficulty,
        payload,
      });
      return { verdict: res.verdict, model: res.model };
    },

    publish: async ({ ctx, section, testId }) => {
      const gate = await contractGate(ctx, section, testId);
      if (!gate.ok) return gate;
      const db = withSuperAdminContext(ctx);
      // approved_by stays null — machine approvals are distinguishable
      // from human ones; the verdict trail lives on GenerationRunItem.
      await db.test.update({
        where: { id: testId },
        data: { status: "Approved", approved_by: null },
      });
      await writeContentLog(ctx, `content.${section}.auto_approved`, {
        test_id: testId,
        auto: true,
      });
      if (section === "listening") {
        // Mirror the human approve path: a partial synth failure does not
        // roll back the approval; the SuperAdmin can re-synthesise from
        // the review page. Full counts land on the run item via the log.
        const synth = await synthesiseListeningClips(ctx, testId);
        if (synth.failures > 0) {
          console.warn("[automation] listening synth partial failure", {
            test_id: testId,
            failures: synth.failures,
            attempted: synth.attempted,
            samples: synth.errorSamples,
          });
        }
      }
      return { ok: true };
    },

    markRejected: async ({ ctx, section, testId, verdict, attempt }) => {
      const db = withSuperAdminContext(ctx);
      await db.test.update({
        where: { id: testId },
        data: { status: "Rejected" },
      });
      await writeContentLog(ctx, `content.${section}.auto_rejected`, {
        test_id: testId,
        auto: true,
        attempt,
        issues: verdict.issues as unknown as Prisma.InputJsonValue,
        feedback: clampForLog(verdict.feedback_for_regeneration),
      });
    },

    log: async (event, { ctx, section, testId, attempt }) => {
      await writeContentLog(ctx, `content.${section}.${event}`, {
        test_id: testId,
        auto: true,
        attempt,
      });
    },
  };
}

// ─── Batch execution + GenerationRun bookkeeping ─────────────────────────

const OUTCOME_TO_DB: Record<
  AutomationItemOutcome,
  "Published" | "PendingHumanReview" | "Failed"
> = {
  published: "Published",
  pending_human_review: "PendingHumanReview",
  failed: "Failed",
};

export type ExecuteRunArgs = {
  scheduleId: string | null;
  trigger: "Scheduled" | "Manual";
  params: AutomationParams;
  count: number;
  ctx: OrgContext;
  autoPublish: boolean;
};

export type ExecuteRunResult = {
  runId: string;
  status: "Succeeded" | "PartialFailure" | "Failed";
  published: number;
  pending: number;
  failed: number;
  fatal: string | null;
};

export async function executeAutomationRun(
  args: ExecuteRunArgs,
): Promise<ExecuteRunResult> {
  const { ctx, params, autoPublish } = args;
  const db = withSuperAdminContext(ctx);
  const count = Math.max(1, Math.min(args.count, AUTOMATION_MAX_COUNT_PER_RUN));
  const deps = buildItemDeps();

  const run = await db.generationRun.create({
    data: {
      schedule_id: args.scheduleId,
      trigger: args.trigger,
      section: DB_SECTION[params.section],
      track: params.track,
      difficulty: params.difficulty,
      requested_count: count,
      auto_publish: autoPublish,
      created_by: ctx.user_id,
    },
    select: { id: true },
  });

  const outcomes: AutomationItemOutcome[] = [];
  let fatal: string | null = null;

  for (let i = 0; i < count; i++) {
    try {
      const item = await runAutomationItem(deps, { ctx, params, autoPublish });
      outcomes.push(item.outcome);
      await db.generationRunItem.create({
        data: {
          run_id: run.id,
          test_id: item.testId,
          outcome: OUTCOME_TO_DB[item.outcome],
          attempts: item.attempts,
          verdicts: item.verdicts as unknown as Prisma.InputJsonValue,
          error: item.error ?? null,
        },
      });
    } catch (err) {
      // QuotaExceededError or an unexpected throw: stop the batch. The
      // remaining slots are simply not attempted — no item rows for them.
      fatal =
        err instanceof QuotaExceededError
          ? "quota: system org daily budget exhausted"
          : err instanceof Error
            ? `${err.name}: ${err.message}`
            : String(err);
      console.error("[automation] run aborted", {
        run_id: run.id,
        slot: i + 1,
        of: count,
        err,
      });
      break;
    }
  }

  const summary = summarizeRunOutcomes(outcomes);
  const status: ExecuteRunResult["status"] =
    fatal !== null
      ? outcomes.length === 0
        ? "Failed"
        : "PartialFailure"
      : summary.status;

  await db.generationRun.update({
    where: { id: run.id },
    data: {
      status,
      published_count: summary.published,
      pending_count: summary.pending,
      failed_count: summary.failed,
      error: fatal,
      finished_at: new Date(),
    },
  });

  return {
    runId: run.id,
    status,
    published: summary.published,
    pending: summary.pending,
    failed: summary.failed,
    fatal,
  };
}
