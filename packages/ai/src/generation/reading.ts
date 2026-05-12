// Reading generation pipeline.
//
// Composes the AI gateway with the canonical generation prompt to
// produce a validated `GeneratedReading` for a (track, difficulty) pair.
//
// Structure mirrors writingGrader: a factory accepting injectable deps,
// plus a production singleton wired to the real gateway + on-disk prompt.
// Tests instantiate the factory with mocks and never hit the network.
//
// Failure modes (all typed):
//   QuotaExceededError       → caller already at daily limit.
//   ModelNotAllowedError     → registry misconfigured (programming error).
//   ProviderError            → OpenRouter failed (502 upstream).
//   GenerationShapeError     → JSON / schema rejected after one retry.
//   GenerationValidationError→ schema OK but content rejected (re-roll).

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
  parseGeneratedReading,
  type GeneratedReading,
} from "./schema";
import { validateGeneratedReading } from "./validate";

const MAX_OUTPUT_TOKENS = 4000;
const STRICTER_RETRY_NUDGE =
  "Your previous response was not valid JSON or did not match the required schema. " +
  "Return ONLY a single JSON object that matches the schema. " +
  "No prose, no markdown fences, no preamble.";

export type GenerateReadingRequest = {
  ctx: OrgContext;
  track: "Academic" | "GeneralTraining";
  // Difficulty 1–5, mapping ~5.0 / 6.0 / 6.5 / 7.0 / 8.0.
  difficulty: number;
  // Optional topic hint passed to the model. Useful when re-rolling to
  // avoid generating two passages on the same topic.
  topicHint?: string;
};

export type GenerateReadingResult = {
  value: GeneratedReading;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  attempts: number;
};

type ChatFn = (req: {
  ctx: OrgContext;
  purpose: "reading-generate";
  messages: { role: "user" | "assistant"; content: string }[];
  system?: string;
  maxTokens: number;
}) => Promise<{
  text: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}>;

export type ReadingGeneratorDeps = {
  ai: { chat: ChatFn };
  loadPrompt: GenerationPromptLoader;
};

function trackLabel(track: GenerateReadingRequest["track"]): string {
  return track === "Academic" ? "Academic" : "General Training";
}

// Per-track word-count targets, surfaced in the USER turn so the model
// sees them last. The window the validator enforces is wider on each
// side (Academic 600–950, GT 400–800) so the model has slack; the target
// here is the centre of the window. Under-writes are the most common
// validation failure mode and this is the cheapest fix for them.
function wordCountTarget(track: GenerateReadingRequest["track"]): string {
  return track === "Academic"
    ? "Aim for 750–850 words of passage prose. Below 600 words will be auto-rejected."
    : "Aim for 550–700 words of passage prose. Below 400 words will be auto-rejected.";
}

function userTurn(req: GenerateReadingRequest): string {
  const lines: string[] = [
    `Generate one IELTS Reading practice unit.`,
    ``,
    `Track: ${trackLabel(req.track)}`,
    `Difficulty: ${req.difficulty} (1=easy ~band 5.0, 5=hard ~band 8.0)`,
    `Passage length: ${wordCountTarget(req.track)}`,
  ];
  if (req.topicHint && req.topicHint.length > 0) {
    lines.push(``, `Topic hint: ${req.topicHint}`);
  }
  lines.push(
    ``,
    `Before you submit, count the words in the passage paragraphs. If the total is below the minimum above, rewrite a longer passage rather than truncate.`,
    ``,
    `Return ONLY the JSON object described in the schema above. No prose, no markdown fences.`,
  );
  return lines.join("\n");
}

export function createReadingGenerator(deps: ReadingGeneratorDeps) {
  return {
    async generate(req: GenerateReadingRequest): Promise<GenerateReadingResult> {
      const system = deps.loadPrompt("reading");
      const turn1 = userTurn(req);

      const first = await deps.ai.chat({
        ctx: req.ctx,
        purpose: "reading-generate",
        system,
        messages: [{ role: "user", content: turn1 }],
        maxTokens: MAX_OUTPUT_TOKENS,
      });

      let parsed = parseGeneratedReading(first.text);
      let attempts = 1;
      let last = first;

      if (!parsed.ok) {
        // One retry, including the model's own malformed output so it can
        // see and fix it. Mirrors the writingGrader pattern.
        const second = await deps.ai.chat({
          ctx: req.ctx,
          purpose: "reading-generate",
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
        parsed = parseGeneratedReading(second.text);
        if (!parsed.ok) {
          throw new GenerationShapeError(parsed.issues, parsed.raw);
        }
      }

      // Schema parsed — now the semantic validator. The validator does
      // not retry: a re-roll is the caller's decision, not the
      // generator's.
      const validation = validateGeneratedReading(parsed.value);
      if (!validation.ok) {
        throw new GenerationValidationError(validation.issues);
      }

      // Cross-check the requested track matches what the model produced.
      // The schema allows either value, but the caller asked for one
      // specifically; mismatch is a re-roll-worthy content failure.
      if (parsed.value.track !== req.track) {
        throw new GenerationValidationError([
          {
            code: "passage.too-short",
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
export const readingGenerator = createReadingGenerator({
  ai: productionAi,
  loadPrompt: loadGenerationPrompt,
});
