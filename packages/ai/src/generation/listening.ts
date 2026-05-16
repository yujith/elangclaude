// Listening generation pipeline.
//
// Composes the AI gateway with the canonical generation prompt to produce
// a validated `GeneratedListening` for a (track, difficulty) pair.
//
// Structure mirrors readingGenerator: a factory accepting injectable
// deps, plus a production singleton wired to the real gateway + on-disk
// prompt. Tests instantiate the factory with mocks and never hit the
// network.
//
// Failure modes (all typed):
//   QuotaExceededError        → caller already at daily limit.
//   ModelNotAllowedError      → registry misconfigured (programming bug).
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
  parseGeneratedListening,
  type GeneratedListening,
} from "./listening-schema";
import { validateGeneratedListening } from "./listening-validate";

// Listening output is significantly bigger than Reading — the script
// adds 4 parts of transcript prose plus the question array. 8000 tokens
// gives the model headroom; the cost-per-Test ceiling stays acceptable
// because the model is OpenRouter cheap-tier.
const MAX_OUTPUT_TOKENS = 8000;

const STRICTER_RETRY_NUDGE =
  "Your previous response was not valid JSON or did not match the required schema. " +
  "Return ONLY a single JSON object that matches the schema. " +
  "No prose, no markdown fences, no preamble.";

export type GenerateListeningRequest = {
  ctx: OrgContext;
  track: "Academic" | "GeneralTraining";
  // 1–5 mapping ~5.0 / 6.0 / 6.5 / 7.0 / 8.0 (band targets).
  difficulty: number;
  // Optional topic hint passed to the model. Useful when re-rolling to
  // avoid generating two sections on the same broad theme.
  topicHint?: string;
};

export type GenerateListeningResult = {
  value: GeneratedListening;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  attempts: number;
};

type ChatFn = (req: {
  ctx: OrgContext;
  purpose: "listening-generate";
  messages: { role: "user" | "assistant"; content: string }[];
  system?: string;
  maxTokens: number;
}) => Promise<{
  text: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}>;

export type ListeningGeneratorDeps = {
  ai: { chat: ChatFn };
  loadPrompt: GenerationPromptLoader;
};

function trackLabel(track: GenerateListeningRequest["track"]): string {
  return track === "Academic" ? "Academic" : "General Training";
}

function userTurn(req: GenerateListeningRequest): string {
  const lines: string[] = [
    `Generate one IELTS Listening section (4 parts, ~20-32 questions total).`,
    ``,
    `Track: ${trackLabel(req.track)}`,
    `Difficulty: ${req.difficulty} (1=easy ~band 5.0, 5=hard ~band 8.0)`,
  ];
  if (req.topicHint && req.topicHint.length > 0) {
    lines.push(``, `Broad topic hint: ${req.topicHint}`);
  }
  lines.push(
    ``,
    `Reminders:`,
    `- Exactly 4 parts in order 1..4.`,
    `- Every accepted answer string for completion / sentence / short-answer questions MUST appear in the parent part's transcript.`,
    `- Slot ids globally unique across all completion_blocks.`,
    `- Question positions globally unique; each appears in exactly one part's question_positions.`,
    `- mcq-multi is ONE Question row with pick_count = correct.length.`,
    ``,
    `Return ONLY the JSON object described in the schema above. No prose, no markdown fences.`,
  );
  return lines.join("\n");
}

export function createListeningGenerator(deps: ListeningGeneratorDeps) {
  return {
    async generate(
      req: GenerateListeningRequest,
    ): Promise<GenerateListeningResult> {
      const system = deps.loadPrompt("listening");
      const turn1 = userTurn(req);

      const first = await deps.ai.chat({
        ctx: req.ctx,
        purpose: "listening-generate",
        system,
        messages: [{ role: "user", content: turn1 }],
        maxTokens: MAX_OUTPUT_TOKENS,
      });

      let parsed = parseGeneratedListening(first.text);
      let attempts = 1;
      let last = first;

      if (!parsed.ok) {
        // One retry. Include the model's malformed output so it can see
        // and fix it. Mirrors the readingGenerator pattern.
        const second = await deps.ai.chat({
          ctx: req.ctx,
          purpose: "listening-generate",
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
        parsed = parseGeneratedListening(second.text);
        if (!parsed.ok) {
          throw new GenerationShapeError(parsed.issues, parsed.raw);
        }
      }

      const validation = validateGeneratedListening(parsed.value);
      if (!validation.ok) {
        throw new GenerationValidationError(validation.issues);
      }

      // Cross-check the requested track matches what the model produced.
      // Listening content is track-agnostic in practice (ADR 0006-style
      // reasoning), but the caller asked for a specific tag and a
      // mismatch suggests the model misread the prompt — a re-roll
      // signal, not a silent rewrite.
      if (parsed.value.track !== req.track) {
        throw new GenerationValidationError([
          {
            code: "positions.question-not-in-any-part",
            message: `Model returned track ${parsed.value.track}, caller asked for ${req.track}.`,
          },
        ]);
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
export const listeningGenerator = createListeningGenerator({
  ai: productionAi,
  loadPrompt: loadGenerationPrompt,
});
