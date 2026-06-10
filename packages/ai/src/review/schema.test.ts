// Contract tests for the reviewer verdict schema (ADR-0024).

import { describe, expect, it } from "vitest";
import { parseReviewVerdict } from "./schema";

const APPROVE = {
  verdict: "approve",
  issues: [],
  feedback_for_regeneration: null,
};

const REJECT = {
  verdict: "reject",
  issues: [
    {
      severity: "critical",
      category: "answer-key-wrong",
      detail: "Q3 keys 'false' but paragraph B states the opposite.",
    },
  ],
  feedback_for_regeneration:
    "Fix question at position 3: the passage contradicts the statement, so the key must be 'false' only if...",
};

describe("parseReviewVerdict", () => {
  it("accepts a clean approve with no issues", () => {
    const res = parseReviewVerdict(JSON.stringify(APPROVE));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.verdict).toBe("approve");
      expect(res.value.issues).toHaveLength(0);
      expect(res.value.feedback_for_regeneration).toBeNull();
    }
  });

  it("accepts an approve carrying minor issues", () => {
    const res = parseReviewVerdict(
      JSON.stringify({
        ...APPROVE,
        issues: [
          {
            severity: "minor",
            category: "difficulty-drift",
            detail: "Reads closer to band 6 than the requested band 7.",
          },
        ],
      }),
    );
    expect(res.ok).toBe(true);
  });

  it("accepts a reject with critical issue + feedback", () => {
    const res = parseReviewVerdict(JSON.stringify(REJECT));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.verdict).toBe("reject");
      expect(res.value.feedback_for_regeneration).toContain("position 3");
    }
  });

  it("rejects a reject verdict without feedback_for_regeneration", () => {
    const res = parseReviewVerdict(
      JSON.stringify({ ...REJECT, feedback_for_regeneration: null }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects a reject verdict whose feedback is whitespace", () => {
    const res = parseReviewVerdict(
      JSON.stringify({ ...REJECT, feedback_for_regeneration: "   " }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects a reject verdict with only minor issues", () => {
    const res = parseReviewVerdict(
      JSON.stringify({
        ...REJECT,
        issues: [
          {
            severity: "minor",
            category: "awkward-phrasing",
            detail: "Q1 phrasing is stiff.",
          },
        ],
      }),
    );
    expect(res.ok).toBe(false);
  });

  it("extracts the JSON object out of fenced / prosy responses", () => {
    const res = parseReviewVerdict(
      "Here is my verdict:\n```json\n" + JSON.stringify(APPROVE) + "\n```\nDone.",
    );
    expect(res.ok).toBe(true);
  });

  it("fails cleanly when there is no JSON object at all", () => {
    const res = parseReviewVerdict("I approve this test.");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.raw).toBe("I approve this test.");
  });

  it("fails cleanly on truncated JSON", () => {
    const res = parseReviewVerdict('{"verdict": "approve", "issues": [');
    expect(res.ok).toBe(false);
  });

  it("rejects unknown verdict values", () => {
    const res = parseReviewVerdict(
      JSON.stringify({ ...APPROVE, verdict: "maybe" }),
    );
    expect(res.ok).toBe(false);
  });
});
