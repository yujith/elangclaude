// Speaking generation pipeline.
//
// Composes the AI gateway with the canonical generation prompt to produce a
// validated `GeneratedSpeaking` — the full 3-part examiner script — for a
// (track, difficulty) request.
//
// Structure mirrors createWritingGenerator: a factory accepting injectable
// deps, plus a production singleton wired to the real gateway + on-disk
// prompt. Tests instantiate the factory with mocks and never hit the network.
//
// Failure modes (all typed):
//   QuotaExceededError        → caller already at daily limit.
//   ModelNotAllowedError      → registry misconfigured (programming error).
//   ProviderError             → OpenRouter failed (502 upstream).
//   GenerationShapeError      → JSON / schema rejected after one retry.
//   GenerationValidationError → schema OK but content rejected (re-roll).

import type { OrgContext } from "@elc/db";
import { ai as productionAi } from "../gateway";
import {
  GenerationShapeError,
  GenerationValidationError,
} from "../errors";
import {
  loadGenerationPrompt,
  type GenerationPromptLoader,
} from "./prompts";
import {
  parseGeneratedSpeaking,
  type GeneratedSpeaking,
} from "./speaking-schema";
import { validateGeneratedSpeaking } from "./speaking-validate";

const MAX_OUTPUT_TOKENS = 2400;
const STRICTER_RETRY_NUDGE =
  "Your previous response was not valid JSON or did not match the required schema. " +
  "Return ONLY a single JSON object that matches the Speaking test schema. " +
  "No prose, no markdown fences, no preamble.";

export type GenerateSpeakingRequest = {
  ctx: OrgContext;
  // IELTS Speaking content is identical across tracks (ADR 0006 D3), but the
  // Test row needs a track tag — the caller picks one.
  track: "Academic" | "GeneralTraining";
  // Difficulty 1–5, mapping ~5.0 / 6.0 / 6.5 / 7.0 / 8.0.
  difficulty: number;
  // Optional topic-domain hint. Useful when re-rolling to avoid generating
  // two tests on the same subject.
  topicHint?: string;
};

export type GenerateSpeakingResult = {
  value: GeneratedSpeaking;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  attempts: number;
};

type ChatFn = (req: {
  ctx: OrgContext;
  purpose: "speaking-cue-generate";
  messages: { role: "user" | "assistant"; content: string }[];
  system?: string;
  maxTokens: number;
}) => Promise<{
  text: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}>;

export type SpeakingGeneratorDeps = {
  ai: { chat: ChatFn };
  loadPrompt: GenerationPromptLoader;
};

function trackLabel(track: "Academic" | "GeneralTraining"): string {
  return track === "Academic" ? "Academic" : "General Training";
}

function userTurn(req: GenerateSpeakingRequest): string {
  const lines: string[] = [
    "Generate one full IELTS Speaking test (Part 1, Part 2 cue card, Part 3).",
    "",
    `Track: ${trackLabel(req.track)}`,
    `Difficulty: ${req.difficulty} (1=easy ~band 5.0, 5=hard ~band 8.0)`,
  ];
  if (req.topicHint && req.topicHint.length > 0) {
    lines.push("", `Topic-domain hint: ${req.topicHint}`);
  }
  lines.push(
    "",
    `Reminders:`,
    `- topic_domain must be a 2-5 word noun phrase shared by Part 2 and Part 3.`,
    `- Part 1 must open with home, hometown, work, or study.`,
    `- Part 2 cue_card_topic must begin with "Describe", follow-up questions must stay short and question-shaped, and final_prompt must begin with "and ".`,
    `- Part 3 must stay in the same domain as Part 2, become more abstract, and every Part 3 prompt must end with "?".`,
    "",
    'Return ONLY the JSON object described in the schema above, with "section": "speaking". No prose, no markdown fences.',
  );
  return lines.join("\n");
}

export function createSpeakingGenerator(deps: SpeakingGeneratorDeps) {
  return {
    async generate(
      req: GenerateSpeakingRequest,
    ): Promise<GenerateSpeakingResult> {
      const system = deps.loadPrompt("speaking");
      const turn1 = userTurn(req);

      const first = await deps.ai.chat({
        ctx: req.ctx,
        purpose: "speaking-cue-generate",
        system,
        messages: [{ role: "user", content: turn1 }],
        maxTokens: MAX_OUTPUT_TOKENS,
      });

      let parsed = parseGeneratedSpeaking(first.text);
      let attempts = 1;
      let last = first;

      if (!parsed.ok) {
        // One retry, including the model's own malformed output so it can
        // see and fix it. Mirrors the writingGenerator pattern.
        const second = await deps.ai.chat({
          ctx: req.ctx,
          purpose: "speaking-cue-generate",
          system,
          messages: [
            { role: "user", content: turn1 },
            { role: "assistant", content: first.text },
            { role: "user", content: STRICTER_RETRY_NUDGE },
          ],
          maxTokens: MAX_OUTPUT_TOKENS,
        });
        attempts = 2;
        last = second;
        parsed = parseGeneratedSpeaking(second.text);
        if (!parsed.ok) {
          throw new GenerationShapeError(parsed.issues, parsed.raw);
        }
      }

      // Cross-check the model produced the track the caller asked for. The
      // schema allows both tracks; a mismatch against the request is a
      // re-roll-worthy content failure.
      if (parsed.value.track !== req.track) {
        throw new GenerationValidationError([
          {
            code: "track.mismatch",
            message: `Model returned track ${parsed.value.track}, caller asked for ${req.track}.`,
          },
        ]);
      }

      // Semantic validator. Does not retry: a re-roll is the caller's
      // decision, not the generator's.
      const validation = validateGeneratedSpeaking(parsed.value);
      if (!validation.ok) {
        throw new GenerationValidationError(validation.issues);
      }

      return {
        value: parsed.value,
        model: last.model,
        usage: last.usage,
        attempts,
      };
    },
  };
}

// Production singleton — wires the real gateway and the on-disk prompt.
export const speakingGenerator = createSpeakingGenerator({
  ai: productionAi,
  loadPrompt: loadGenerationPrompt,
});
