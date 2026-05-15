// Speaking grader. Composes the AI gateway with the canonical Speaking
// grading prompt to produce a validated `SpeakingGrade` for a finished
// attempt.
//
// Structure mirrors the writing grader: a factory accepting injectable
// deps, plus a production singleton wired to the real gateway and the
// disk-backed prompt loader. Tests instantiate the factory with mocks
// and never hit the network or the filesystem.
//
// Calibration: this module enforces the contract shape (Zod schema +
// one retry on malformed JSON). Calibration *content* lives in the
// Markdown prompt under `prompts/grading/speaking.md`.

import type { OrgContext } from "@elc/db";
import { ai as productionAi } from "../gateway";
import type { AudioFeatures } from "../audio/features";
import { GradeShapeError } from "../errors";
import { parseSpeakingGrade, type SpeakingGrade } from "./speaking-schema";
import { loadSpeakingPrompt, type SpeakingPromptLoader } from "./prompts";

const MAX_OUTPUT_TOKENS = 1800;
const INPUTS_PLACEHOLDER = "<<INPUTS>>";

const STRICTER_RETRY_NUDGE =
  "Your previous response was not valid JSON or did not match the required schema. " +
  "Return ONLY a single JSON object that matches the schema. No prose, no markdown fences, no preamble.";

export type SpeakingPartKey = "part1" | "part2" | "part3";

export type SpeakingGradeRequest = {
  ctx: OrgContext;
  transcripts: Record<SpeakingPartKey, string>;
  audioFeatures: AudioFeatures;
  // Parts the candidate actually produced words in. An IELTS Speaking
  // attempt missing Part 2 or Part 3 cannot defensibly score above
  // mid-band — the grader is told this explicitly via the prompt.
  partsCovered: readonly SpeakingPartKey[];
  // The IELTS Speaking content the candidate was responding to. The
  // grader uses it for context, e.g. to judge whether Part 2 stayed on
  // the cue card.
  testContent: {
    part2_cue_card: string;
    part3_theme: string;
  };
};

export type SpeakingGradeOutput = {
  grade: SpeakingGrade;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  attempts: number;
};

// Smallest slice of the gateway we depend on, so tests don't have to fake
// the whole factory.
type ChatFn = (req: {
  ctx: OrgContext;
  purpose: "speaking-grade";
  messages: { role: "user" | "assistant"; content: string }[];
  system?: string;
  maxTokens: number;
}) => Promise<{
  text: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}>;

export type SpeakingGraderDeps = {
  ai: { chat: ChatFn };
  loadPrompt: SpeakingPromptLoader;
};

function buildInputs(req: SpeakingGradeRequest): string {
  return JSON.stringify(
    {
      transcripts: req.transcripts,
      audio_features: req.audioFeatures,
      parts_covered: req.partsCovered,
      test_content: req.testContent,
    },
    null,
    2,
  );
}

function fillPrompt(body: string, inputsJson: string): string {
  return body.replace(INPUTS_PLACEHOLDER, inputsJson);
}

export function createSpeakingGrader(deps: SpeakingGraderDeps) {
  return {
    async grade(req: SpeakingGradeRequest): Promise<SpeakingGradeOutput> {
      const inputs = buildInputs(req);
      const system = fillPrompt(deps.loadPrompt(), inputs);

      // First pass: send the prompt, ask for JSON.
      const first = await deps.ai.chat({
        ctx: req.ctx,
        purpose: "speaking-grade",
        system,
        messages: [
          {
            role: "user",
            content:
              "Grade the Speaking attempt above. Return ONLY the JSON object — no prose, no markdown fences.",
          },
        ],
        maxTokens: MAX_OUTPUT_TOKENS,
      });

      const firstParse = parseSpeakingGrade(first.text);
      if (firstParse.ok) {
        return {
          grade: firstParse.grade,
          model: first.model,
          usage: first.usage,
          attempts: 1,
        };
      }

      // Retry once with the original turn included so the model sees its
      // own malformed output and can correct itself.
      const second = await deps.ai.chat({
        ctx: req.ctx,
        purpose: "speaking-grade",
        system,
        messages: [
          {
            role: "user",
            content:
              "Grade the Speaking attempt above. Return ONLY the JSON object — no prose, no markdown fences.",
          },
          { role: "assistant", content: first.text },
          { role: "user", content: STRICTER_RETRY_NUDGE },
        ],
        maxTokens: MAX_OUTPUT_TOKENS,
      });

      const secondParse = parseSpeakingGrade(second.text);
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

// Production singleton — wires the real gateway and the disk-backed
// prompt loader. Routes/actions import `speakingGrader.grade(...)`.
export const speakingGrader = createSpeakingGrader({
  ai: productionAi,
  loadPrompt: loadSpeakingPrompt,
});
