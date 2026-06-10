// Automated content reviewer (ADR-0024).
//
// Composes the AI gateway with the per-section review prompt to produce a
// structured verdict on one generated test unit. The reviewer is the
// machine stand-in for the human moderation gate: the automation
// orchestrator publishes on `approve` and regenerates with
// `feedback_for_regeneration` on `reject`.
//
// Structure mirrors the generators: a factory accepting injectable deps,
// plus a production singleton wired to the real gateway + on-disk prompts.
// Tests instantiate the factory with mocks and never hit the network.
//
// Failure modes (all typed):
//   QuotaExceededError → system org at daily limit.
//   ProviderError      → Anthropic failed upstream.
//   ReviewShapeError   → verdict JSON rejected after the retry budget.

import type { OrgContext } from "@elc/db";
import { ai as productionAi } from "../gateway";
import { ReviewShapeError } from "../errors";
import {
  loadReviewPrompt,
  type ReviewPromptLoader,
  type ReviewSection,
} from "./prompts";
import { parseReviewVerdict, type ReviewVerdict } from "./schema";

// Verdict JSON is small; the budget covers a long feedback_for_regeneration
// plus a full issues list with headroom.
const MAX_OUTPUT_TOKENS = 3000;
const MAX_REVIEW_ATTEMPTS = 2;
const STRICTER_RETRY_NUDGE =
  "Your previous response was not a valid verdict object. " +
  "Return ONLY a single JSON object with keys verdict, issues, " +
  "feedback_for_regeneration, exactly as specified. A reject verdict " +
  "must include at least one critical issue and non-null " +
  "feedback_for_regeneration. No prose, no markdown fences, no preamble.";

export type ReviewContentRequest = {
  ctx: OrgContext;
  section: ReviewSection;
  track: "Academic" | "GeneralTraining";
  // Difficulty 1–5, mapping ~5.0 / 6.0 / 6.5 / 7.0 / 8.0.
  difficulty: number;
  // The generated unit exactly as the generator returned it
  // (GeneratedReading / GeneratedListening / GeneratedWriting /
  // GeneratedSpeaking). Passed opaquely — the reviewer judges content,
  // the contract validators have already enforced shape.
  payload: unknown;
};

export type ReviewContentResult = {
  verdict: ReviewVerdict;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  attempts: number;
};

type ChatFn = (req: {
  ctx: OrgContext;
  purpose: "content-review";
  messages: { role: "user" | "assistant"; content: string }[];
  system?: string;
  maxTokens: number;
}) => Promise<{
  text: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}>;

export type ContentReviewerDeps = {
  ai: { chat: ChatFn };
  loadPrompt: ReviewPromptLoader;
};

function trackLabel(track: ReviewContentRequest["track"]): string {
  return track === "Academic" ? "Academic" : "General Training";
}

function userTurn(req: ReviewContentRequest): string {
  return [
    `Review one candidate IELTS ${req.section} test unit.`,
    ``,
    `Track: ${trackLabel(req.track)}`,
    `Requested difficulty: ${req.difficulty} (1=easy ~band 5.0, 5=hard ~band 8.0)`,
    ``,
    `Candidate unit JSON:`,
    JSON.stringify(req.payload),
    ``,
    `Apply the review checklist from your instructions to this unit.`,
    `Return ONLY the verdict JSON object. No prose, no markdown fences.`,
  ].join("\n");
}

export function createContentReviewer(deps: ContentReviewerDeps) {
  return {
    async review(req: ReviewContentRequest): Promise<ReviewContentResult> {
      const system = deps.loadPrompt(req.section);
      const messages: { role: "user" | "assistant"; content: string }[] = [
        { role: "user", content: userTurn(req) },
      ];
      let lastText = "";
      let lastIssues: unknown = [];

      for (let attempts = 1; attempts <= MAX_REVIEW_ATTEMPTS; attempts++) {
        const res = await deps.ai.chat({
          ctx: req.ctx,
          purpose: "content-review",
          system,
          messages,
          maxTokens: MAX_OUTPUT_TOKENS,
        });
        lastText = res.text;

        const parsed = parseReviewVerdict(res.text);
        if (parsed.ok) {
          return {
            verdict: parsed.value,
            model: res.model,
            usage: res.usage,
            attempts,
          };
        }
        lastIssues = parsed.issues;
        if (attempts < MAX_REVIEW_ATTEMPTS) {
          messages.push(
            { role: "assistant", content: res.text },
            { role: "user", content: STRICTER_RETRY_NUDGE },
          );
        }
      }

      throw new ReviewShapeError(lastIssues, lastText);
    },
  };
}

// Production singleton — wires the real gateway and the on-disk prompts.
export const contentReviewer = createContentReviewer({
  ai: productionAi,
  loadPrompt: loadReviewPrompt,
});
