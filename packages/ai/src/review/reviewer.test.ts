// Contract tests for the automated content reviewer (ADR-0024).
//
// Uses an injected fake chat — no live network. Covers:
//   - Happy path: verdict JSON → typed result, correct purpose/system/turn.
//   - Retry on malformed verdict: first response junk, second valid.
//   - ReviewShapeError after the retry budget.
//   - Reject verdicts flow through untouched (feedback preserved).

import { describe, expect, it } from "vitest";
import type { OrgContext } from "@elc/db";
import { ReviewShapeError } from "../errors";
import { createContentReviewer } from "./reviewer";

const CTX: OrgContext = {
  org_id: "system",
  user_id: "super_1",
  role: "SuperAdmin",
};

const PROMPT_BODY = "FAKE REVIEW PROMPT";

const APPROVE_JSON = JSON.stringify({
  verdict: "approve",
  issues: [],
  feedback_for_regeneration: null,
});

const REJECT_JSON = JSON.stringify({
  verdict: "reject",
  issues: [
    {
      severity: "critical",
      category: "answer-not-spoken",
      detail: "Part 2 Q7 keyed answer never occurs in the speech segments.",
    },
  ],
  feedback_for_regeneration:
    "Rewrite Part 2 so the answer to question at position 7 is spoken verbatim by the monologue speaker.",
});

type ChatCall = {
  purpose: string;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
};

function fakeAi(responses: string[]) {
  const calls: ChatCall[] = [];
  let i = 0;
  return {
    calls,
    ai: {
      chat: async (req: ChatCall & { ctx: OrgContext }) => {
        calls.push({
          purpose: req.purpose,
          system: req.system,
          messages: [...req.messages],
          maxTokens: req.maxTokens,
        });
        const text = responses[Math.min(i, responses.length - 1)] ?? "";
        i++;
        return {
          text,
          model: "claude-sonnet-4-5-20250929",
          usage: { input_tokens: 1000, output_tokens: 200 },
        };
      },
    },
  };
}

const PAYLOAD = { track: "Academic", difficulty: 3, questions: [] };

function makeReviewer(responses: string[]) {
  const fake = fakeAi(responses);
  const reviewer = createContentReviewer({
    ai: fake.ai,
    loadPrompt: () => PROMPT_BODY,
  });
  return { reviewer, fake };
}

describe("contentReviewer", () => {
  it("returns the parsed verdict on the first attempt", async () => {
    const { reviewer, fake } = makeReviewer([APPROVE_JSON]);
    const res = await reviewer.review({
      ctx: CTX,
      section: "reading",
      track: "Academic",
      difficulty: 3,
      payload: PAYLOAD,
    });

    expect(res.verdict.verdict).toBe("approve");
    expect(res.attempts).toBe(1);
    expect(res.model).toBe("claude-sonnet-4-5-20250929");

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.purpose).toBe("content-review");
    expect(call.system).toBe(PROMPT_BODY);
    // The user turn carries the request context and the payload verbatim.
    const turn = call.messages[0]!.content;
    expect(turn).toContain("Track: Academic");
    expect(turn).toContain("Requested difficulty: 3");
    expect(turn).toContain(JSON.stringify(PAYLOAD));
  });

  it("retries once with a stricter nudge on malformed verdict", async () => {
    const { reviewer, fake } = makeReviewer(["not json at all", REJECT_JSON]);
    const res = await reviewer.review({
      ctx: CTX,
      section: "listening",
      track: "GeneralTraining",
      difficulty: 4,
      payload: PAYLOAD,
    });

    expect(res.attempts).toBe(2);
    expect(res.verdict.verdict).toBe("reject");
    expect(res.verdict.feedback_for_regeneration).toContain("position 7");

    expect(fake.calls).toHaveLength(2);
    const retry = fake.calls[1]!.messages;
    // History: original turn, junk assistant reply, stricter nudge.
    expect(retry).toHaveLength(3);
    expect(retry[1]!.role).toBe("assistant");
    expect(retry[2]!.content).toContain("Return ONLY a single JSON object");
  });

  it("throws ReviewShapeError when both attempts are malformed", async () => {
    const { reviewer } = makeReviewer(["junk one", "junk two"]);
    await expect(
      reviewer.review({
        ctx: CTX,
        section: "writing",
        track: "Academic",
        difficulty: 2,
        payload: PAYLOAD,
      }),
    ).rejects.toBeInstanceOf(ReviewShapeError);
  });

  it("treats a schema-invalid verdict (reject without feedback) as malformed", async () => {
    const bad = JSON.stringify({
      verdict: "reject",
      issues: [],
      feedback_for_regeneration: null,
    });
    const { reviewer, fake } = makeReviewer([bad, APPROVE_JSON]);
    const res = await reviewer.review({
      ctx: CTX,
      section: "speaking",
      track: "Academic",
      difficulty: 5,
      payload: PAYLOAD,
    });
    expect(res.attempts).toBe(2);
    expect(fake.calls).toHaveLength(2);
  });
});
