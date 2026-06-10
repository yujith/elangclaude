// Contract tests for the auto-generation orchestration engine (ADR-0024).
//
// All deps are fakes — no DB, no network. The matrix:
//   - approve first try + auto-publish on  → published
//   - approve + auto-publish off           → pending (approved_publish_off)
//   - reject → revise → approve            → published, revision threaded
//   - reject × budget                      → pending (review_exhausted)
//   - generation failure                   → failed (generate_failed)
//   - review throws                        → failed (review_failed)
//   - review throws QuotaExceededError     → propagates (batch must stop)
//   - publish gate failure                 → failed (publish_failed)
//   - summarizeRunOutcomes rollups

import { describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@elc/db";
import { QuotaExceededError } from "../errors";
import {
  AUTOMATION_MAX_GENERATIONS,
  runAutomationItem,
  summarizeRunOutcomes,
  type AutomationGenerateResult,
  type AutomationItemDeps,
  type AutomationParams,
} from "./engine";
import type { ReviewVerdict } from "../review/schema";

const CTX: OrgContext = {
  org_id: "system",
  user_id: "super_1",
  role: "SuperAdmin",
};

const PARAMS: AutomationParams = {
  section: "reading",
  track: "Academic",
  difficulty: 3,
};

const APPROVE: ReviewVerdict = {
  verdict: "approve",
  issues: [],
  feedback_for_regeneration: null,
};

const REJECT: ReviewVerdict = {
  verdict: "reject",
  issues: [
    {
      severity: "critical",
      category: "answer-key-wrong",
      detail: "Q2 keys 'not given' but paragraph C states it.",
    },
  ],
  feedback_for_regeneration: "Fix question at position 2.",
};

function genOk(n: number): AutomationGenerateResult {
  return {
    ok: true,
    testId: `test_${n}`,
    payload: { unit: n },
    responseText: `{"unit":${n}}`,
    model: "gpt-4.1-mini",
  };
}

function makeDeps(overrides: Partial<AutomationItemDeps> = {}) {
  let genCount = 0;
  const deps: AutomationItemDeps = {
    generate: vi.fn(async () => genOk(++genCount)),
    review: vi.fn(async () => ({ verdict: APPROVE, model: "sonnet" })),
    publish: vi.fn(async () => ({ ok: true as const })),
    markRejected: vi.fn(async () => undefined),
    log: vi.fn(async () => undefined),
    ...overrides,
  };
  return deps;
}

describe("runAutomationItem", () => {
  it("publishes a first-try approval when auto-publish is on", async () => {
    const deps = makeDeps();
    const res = await runAutomationItem(deps, {
      ctx: CTX,
      params: PARAMS,
      autoPublish: true,
    });

    expect(res.outcome).toBe("published");
    expect(res.reason).toBe("published");
    expect(res.testId).toBe("test_1");
    expect(res.attempts).toBe(1);
    expect(res.verdicts).toHaveLength(1);
    expect(deps.publish).toHaveBeenCalledTimes(1);
    expect(deps.markRejected).not.toHaveBeenCalled();
  });

  it("leaves an approved candidate pending when auto-publish is off", async () => {
    const deps = makeDeps();
    const res = await runAutomationItem(deps, {
      ctx: CTX,
      params: PARAMS,
      autoPublish: false,
    });

    expect(res.outcome).toBe("pending_human_review");
    expect(res.reason).toBe("approved_publish_off");
    expect(res.testId).toBe("test_1");
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(
      "auto_review_passed",
      expect.objectContaining({ testId: "test_1", attempt: 1 }),
    );
  });

  it("threads reviewer feedback into the regeneration after a reject", async () => {
    const review = vi
      .fn()
      .mockResolvedValueOnce({ verdict: REJECT, model: "sonnet" })
      .mockResolvedValueOnce({ verdict: APPROVE, model: "sonnet" });
    const deps = makeDeps({ review });
    const res = await runAutomationItem(deps, {
      ctx: CTX,
      params: PARAMS,
      autoPublish: true,
    });

    expect(res.outcome).toBe("published");
    expect(res.testId).toBe("test_2");
    expect(res.attempts).toBe(2);
    expect(res.verdicts.map((v) => v.verdict)).toEqual(["reject", "approve"]);

    // The first candidate was retired with the verdict attached.
    expect(deps.markRejected).toHaveBeenCalledTimes(1);
    expect(deps.markRejected).toHaveBeenCalledWith(
      expect.objectContaining({ testId: "test_1", attempt: 1 }),
    );

    // The second generate call carried the revision context.
    const secondGenArgs = vi.mocked(deps.generate).mock.calls[1]![0];
    expect(secondGenArgs.revision).toEqual({
      previousResponseText: '{"unit":1}',
      feedback: "Fix question at position 2.",
    });
  });

  it("exhausts the budget and leaves the last candidate for humans", async () => {
    const review = vi.fn(async () => ({ verdict: REJECT, model: "sonnet" }));
    const deps = makeDeps({ review });
    const res = await runAutomationItem(deps, {
      ctx: CTX,
      params: PARAMS,
      autoPublish: true,
    });

    expect(res.outcome).toBe("pending_human_review");
    expect(res.reason).toBe("review_exhausted");
    expect(res.attempts).toBe(AUTOMATION_MAX_GENERATIONS);
    expect(res.testId).toBe(`test_${AUTOMATION_MAX_GENERATIONS}`);
    expect(res.verdicts).toHaveLength(AUTOMATION_MAX_GENERATIONS);
    // Intermediates rejected; the final candidate is NOT.
    expect(deps.markRejected).toHaveBeenCalledTimes(
      AUTOMATION_MAX_GENERATIONS - 1,
    );
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(
      "auto_review_exhausted",
      expect.objectContaining({ testId: `test_${AUTOMATION_MAX_GENERATIONS}` }),
    );
  });

  it("fails the item when generation fails", async () => {
    const deps = makeDeps({
      generate: vi.fn(async () => ({
        ok: false as const,
        error: "validation: passage.too-short",
      })),
    });
    const res = await runAutomationItem(deps, {
      ctx: CTX,
      params: PARAMS,
      autoPublish: true,
    });

    expect(res.outcome).toBe("failed");
    expect(res.reason).toBe("generate_failed");
    expect(res.testId).toBeNull();
    expect(res.error).toContain("passage.too-short");
  });

  it("fails the item (candidate kept pending) when review throws", async () => {
    const deps = makeDeps({
      review: vi.fn(async () => {
        throw new Error("anthropic 529");
      }),
    });
    const res = await runAutomationItem(deps, {
      ctx: CTX,
      params: PARAMS,
      autoPublish: true,
    });

    expect(res.outcome).toBe("failed");
    expect(res.reason).toBe("review_failed");
    expect(res.testId).toBe("test_1");
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("propagates QuotaExceededError so the batch stops", async () => {
    const deps = makeDeps({
      review: vi.fn(async () => {
        throw new QuotaExceededError("super_1", 2000, 2000);
      }),
    });
    await expect(
      runAutomationItem(deps, { ctx: CTX, params: PARAMS, autoPublish: true }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("fails the item when the publish gate refuses", async () => {
    const deps = makeDeps({
      publish: vi.fn(async () => ({
        ok: false as const,
        error: "contract: body_json no longer parses",
      })),
    });
    const res = await runAutomationItem(deps, {
      ctx: CTX,
      params: PARAMS,
      autoPublish: true,
    });

    expect(res.outcome).toBe("failed");
    expect(res.reason).toBe("publish_failed");
    expect(res.testId).toBe("test_1");
  });
});

describe("summarizeRunOutcomes", () => {
  it("rolls up all-published as Succeeded", () => {
    expect(summarizeRunOutcomes(["published", "published"])).toEqual({
      published: 2,
      pending: 0,
      failed: 0,
      status: "Succeeded",
    });
  });

  it("counts pending as success (no failures)", () => {
    expect(
      summarizeRunOutcomes(["published", "pending_human_review"]).status,
    ).toBe("Succeeded");
  });

  it("mixed failure is PartialFailure", () => {
    expect(
      summarizeRunOutcomes(["published", "failed"]).status,
    ).toBe("PartialFailure");
  });

  it("all-failed is Failed", () => {
    expect(summarizeRunOutcomes(["failed", "failed"]).status).toBe("Failed");
  });
});
