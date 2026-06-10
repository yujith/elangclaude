// Auto-generation orchestration engine (ADR-0024).
//
// Drives ONE candidate slot through the generate → review → regenerate
// loop and decides where the candidate ends up:
//
//   reviewer approves + auto-publish on  → published (Approved, learner-visible)
//   reviewer approves + auto-publish off → PendingReview, pre-screened for humans
//   reviewer rejects, retries left       → candidate marked Rejected, regenerate
//                                          with the reviewer's feedback
//   reviewer rejects, budget exhausted   → last candidate left PendingReview
//   anything errors                      → failed; any persisted candidate is
//                                          NEVER published
//
// The engine is pure orchestration: every side effect (generation+persist,
// review, publish gate, status flips, ActivityLog) is an injected dep, so
// the loop is unit-testable without a DB or network. The app layer
// (apps/web/lib/automation/) wires the real implementations and owns
// GenerationRun/GenerationRunItem bookkeeping.

import type { OrgContext } from "@elc/db";
import { QuotaExceededError } from "../errors";
import type { GenerationRevision } from "../generation/revision";
import type { ReviewSection } from "../review/prompts";
import type { ReviewIssue, ReviewVerdict } from "../review/schema";

// 3 generations per slot: the original + two reviewer-guided revisions.
export const AUTOMATION_MAX_GENERATIONS = 3;
// Hard cap on tests per run — schedule `count` is clamped to this in the
// app layer. Budget guard, not a tuning knob.
export const AUTOMATION_MAX_COUNT_PER_RUN = 10;

export type AutomationParams = {
  section: ReviewSection;
  track: "Academic" | "GeneralTraining";
  difficulty: number;
  // Academic Reading IELTS part (1|2|3).
  part?: 1 | 2 | 3;
  // Writing only (WritingTaskKind).
  taskKind?: string;
  topicHint?: string;
};

// Generate one unit AND persist it as PendingReview. Implementations
// catch the typed generation errors and fold them into `ok: false`;
// QuotaExceededError must be rethrown so the whole batch stops.
export type AutomationGenerateResult =
  | {
      ok: true;
      testId: string;
      // The parsed generation, passed to the reviewer as-is.
      payload: unknown;
      // Serialised form used to seed a revision conversation.
      responseText: string;
      model: string;
    }
  | { ok: false; error: string };

export type AttemptVerdict = {
  attempt: number;
  verdict: "approve" | "reject";
  issues: ReviewIssue[];
  feedback_for_regeneration: string | null;
  reviewer_model: string;
};

export type AutomationItemDeps = {
  generate(args: {
    ctx: OrgContext;
    params: AutomationParams;
    revision?: GenerationRevision;
  }): Promise<AutomationGenerateResult>;
  review(args: {
    ctx: OrgContext;
    section: ReviewSection;
    track: "Academic" | "GeneralTraining";
    difficulty: number;
    payload: unknown;
  }): Promise<{ verdict: ReviewVerdict; model: string }>;
  // Publish gate: re-run the section's contract validation on the
  // persisted record, flip to Approved, fire section side effects
  // (Listening TTS synth), write the ActivityLog row. `ok: false` means
  // the candidate stays PendingReview.
  publish(args: {
    ctx: OrgContext;
    section: ReviewSection;
    testId: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  // Flip a reviewer-rejected intermediate candidate to Rejected + log.
  markRejected(args: {
    ctx: OrgContext;
    section: ReviewSection;
    testId: string;
    verdict: ReviewVerdict;
    attempt: number;
  }): Promise<void>;
  // ActivityLog for the two leave-it-pending outcomes.
  log(
    event: "auto_review_passed" | "auto_review_exhausted",
    args: {
      ctx: OrgContext;
      section: ReviewSection;
      testId: string;
      attempt: number;
    },
  ): Promise<void>;
};

export type AutomationItemOutcome =
  | "published"
  | "pending_human_review"
  | "failed";

export type AutomationItemResult = {
  outcome: AutomationItemOutcome;
  reason:
    | "published"
    | "approved_publish_off"
    | "review_exhausted"
    | "generate_failed"
    | "review_failed"
    | "publish_failed";
  // The final candidate (null when generation itself failed).
  testId: string | null;
  // Generation cycles consumed.
  attempts: number;
  verdicts: AttemptVerdict[];
  error?: string;
};

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

export async function runAutomationItem(
  deps: AutomationItemDeps,
  args: {
    ctx: OrgContext;
    params: AutomationParams;
    autoPublish: boolean;
  },
): Promise<AutomationItemResult> {
  const { ctx, params, autoPublish } = args;
  const verdicts: AttemptVerdict[] = [];
  let revision: GenerationRevision | undefined;

  for (let attempt = 1; attempt <= AUTOMATION_MAX_GENERATIONS; attempt++) {
    const gen = await deps.generate({ ctx, params, revision });
    if (!gen.ok) {
      return {
        outcome: "failed",
        reason: "generate_failed",
        testId: null,
        attempts: attempt,
        verdicts,
        error: gen.error,
      };
    }

    let review: { verdict: ReviewVerdict; model: string };
    try {
      review = await deps.review({
        ctx,
        section: params.section,
        track: params.track,
        difficulty: params.difficulty,
        payload: gen.payload,
      });
    } catch (err) {
      // Quota exhaustion aborts the whole batch — retrying other slots
      // would just burn the remaining budget on guaranteed failures.
      if (err instanceof QuotaExceededError) throw err;
      // No verdict — the candidate is never published. It stays
      // PendingReview where a human can rescue it.
      return {
        outcome: "failed",
        reason: "review_failed",
        testId: gen.testId,
        attempts: attempt,
        verdicts,
        error: describeError(err),
      };
    }

    verdicts.push({
      attempt,
      verdict: review.verdict.verdict,
      issues: review.verdict.issues,
      feedback_for_regeneration: review.verdict.feedback_for_regeneration,
      reviewer_model: review.model,
    });

    if (review.verdict.verdict === "approve") {
      if (!autoPublish) {
        await deps.log("auto_review_passed", {
          ctx,
          section: params.section,
          testId: gen.testId,
          attempt,
        });
        return {
          outcome: "pending_human_review",
          reason: "approved_publish_off",
          testId: gen.testId,
          attempts: attempt,
          verdicts,
        };
      }
      const pub = await deps.publish({
        ctx,
        section: params.section,
        testId: gen.testId,
      });
      if (!pub.ok) {
        return {
          outcome: "failed",
          reason: "publish_failed",
          testId: gen.testId,
          attempts: attempt,
          verdicts,
          error: pub.error,
        };
      }
      return {
        outcome: "published",
        reason: "published",
        testId: gen.testId,
        attempts: attempt,
        verdicts,
      };
    }

    // Reject. With retries left: retire this candidate and regenerate
    // with the reviewer's feedback. On the final attempt: leave the
    // candidate PendingReview — a human may still disagree with the
    // reviewer, and the verdict trail is attached either way.
    if (attempt < AUTOMATION_MAX_GENERATIONS) {
      await deps.markRejected({
        ctx,
        section: params.section,
        testId: gen.testId,
        verdict: review.verdict,
        attempt,
      });
      revision = {
        previousResponseText: gen.responseText,
        feedback: review.verdict.feedback_for_regeneration ?? "",
      };
      continue;
    }
    await deps.log("auto_review_exhausted", {
      ctx,
      section: params.section,
      testId: gen.testId,
      attempt,
    });
    return {
      outcome: "pending_human_review",
      reason: "review_exhausted",
      testId: gen.testId,
      attempts: attempt,
      verdicts,
    };
  }

  // The loop always returns within AUTOMATION_MAX_GENERATIONS iterations.
  throw new Error("unreachable: automation loop exited without a result");
}

// Run-level rollup used for GenerationRun.status.
export function summarizeRunOutcomes(outcomes: AutomationItemOutcome[]): {
  published: number;
  pending: number;
  failed: number;
  status: "Succeeded" | "PartialFailure" | "Failed";
} {
  const published = outcomes.filter((o) => o === "published").length;
  const pending = outcomes.filter((o) => o === "pending_human_review").length;
  const failed = outcomes.filter((o) => o === "failed").length;
  const status =
    failed === 0
      ? "Succeeded"
      : failed === outcomes.length
        ? "Failed"
        : "PartialFailure";
  return { published, pending, failed, status };
}
