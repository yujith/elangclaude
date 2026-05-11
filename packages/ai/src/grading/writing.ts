// Writing grader. Composes the AI gateway with the canonical Writing
// grading prompts to produce a validated WritingGrade for a candidate
// response.
//
// Structure mirrors the gateway: a factory accepting injectable deps,
// plus a production singleton wired to the real gateway and disk-backed
// prompt loader. Tests instantiate the factory with mocks and never hit
// the network or filesystem.
//
// Calibration: this module enforces the contract shape (Zod schema +
// one retry on malformed JSON). Calibration *content* lives in the
// Markdown prompts under prompts/grading/.

import type { OrgContext } from "@elc/db";
import { ai as productionAi } from "../gateway";
import { GradeShapeError } from "../errors";
import { parseWritingGrade, type WritingGrade } from "./schema";
import {
  loadWritingPrompt,
  type PromptLoader,
  type WritingTaskKind,
} from "./prompts";

const MAX_OUTPUT_TOKENS = 1500;
const TASK_PLACEHOLDER = "<<TASK_PROMPT>>";
const RESPONSE_PLACEHOLDER = "<<RESPONSE>>";

const STRICTER_RETRY_NUDGE =
  "Your previous response was not valid JSON or did not match the required schema. " +
  "Return ONLY a single JSON object that matches the schema. No prose, no markdown fences, no preamble.";

export type GradeRequest = {
  ctx: OrgContext;
  taskType: WritingTaskKind;
  taskPrompt: string;
  responseText: string;
};

export type GradeOutput = {
  grade: WritingGrade;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  attempts: number;
};

// We depend on the smallest possible slice of the gateway so tests don't
// have to fake the entire factory. The `chat` signature here is shaped to
// pass through what the production gateway requires.
type ChatFn = (req: {
  ctx: OrgContext;
  purpose: "writing-grade";
  messages: { role: "user" | "assistant"; content: string }[];
  system?: string;
  maxTokens: number;
}) => Promise<{
  text: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}>;

export type WritingGraderDeps = {
  ai: { chat: ChatFn };
  loadPrompt: PromptLoader;
};

function fillPrompt(body: string, taskPrompt: string, responseText: string): string {
  return body
    .replace(TASK_PLACEHOLDER, taskPrompt)
    .replace(RESPONSE_PLACEHOLDER, responseText);
}

export function createWritingGrader(deps: WritingGraderDeps) {
  return {
    async grade(req: GradeRequest): Promise<GradeOutput> {
      const system = fillPrompt(
        deps.loadPrompt(req.taskType),
        req.taskPrompt,
        req.responseText,
      );

      // First pass: send the prompt, ask for JSON.
      const first = await deps.ai.chat({
        ctx: req.ctx,
        purpose: "writing-grade",
        system,
        messages: [
          {
            role: "user",
            content:
              "Grade the response above. Return ONLY the JSON object — no prose, no markdown fences.",
          },
        ],
        maxTokens: MAX_OUTPUT_TOKENS,
      });

      const firstParse = parseWritingGrade(first.text);
      if (firstParse.ok) {
        return {
          grade: firstParse.grade,
          model: first.model,
          usage: first.usage,
          attempts: 1,
        };
      }

      // Retry once with the original turn included so the model sees its
      // own malformed output and can correct itself. Anthropic's API
      // handles this assistant-then-user pattern naturally.
      const second = await deps.ai.chat({
        ctx: req.ctx,
        purpose: "writing-grade",
        system,
        messages: [
          {
            role: "user",
            content:
              "Grade the response above. Return ONLY the JSON object — no prose, no markdown fences.",
          },
          { role: "assistant", content: first.text },
          { role: "user", content: STRICTER_RETRY_NUDGE },
        ],
        maxTokens: MAX_OUTPUT_TOKENS,
      });

      const secondParse = parseWritingGrade(second.text);
      if (secondParse.ok) {
        return {
          grade: secondParse.grade,
          model: second.model,
          usage: second.usage,
          attempts: 2,
        };
      }

      throw new GradeShapeError(secondParse.issues, second.text);
    },
  };
}

// Production singleton — wires the real gateway and the disk-backed prompt
// loader. Routes/actions import `writingGrader.grade(...)` directly.
export const writingGrader = createWritingGrader({
  ai: productionAi,
  loadPrompt: loadWritingPrompt,
});
