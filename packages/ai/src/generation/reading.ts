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
//   GenerationShapeError     → JSON / schema rejected after retry budget.
//   GenerationValidationError→ schema OK but content rejected after retry budget.

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
import { seedMessages, type GenerationRevision } from "./revision";
import {
  parseGeneratedReading,
  type GeneratedReading,
} from "./schema";
import {
  validateGeneratedReading,
  type ValidationIssue,
  type ValidationResult,
} from "./validate";

const MAX_OUTPUT_TOKENS = 6000;
const MAX_GENERATION_ATTEMPTS = 3;
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
  // ADR-0024 automation: when the content reviewer rejected a previous
  // unit, seed the conversation with that unit + the reviewer's feedback
  // so the regeneration is a targeted fix rather than a blind re-roll.
  revision?: GenerationRevision;
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
    `Structure reminders:`,
    req.track === "Academic"
      ? `- Academic outputs need 5-7 paragraphs labelled A.. and 6-10 questions.`
      : `- General Training outputs need 4-6 paragraphs labelled A.., 6-10 questions, and a required passage.gt_context value.`,
    `- Use contiguous 0-indexed question positions in display order.`,
    `- Every accepted answer for sentence-completion and short-answer questions must be a literal passage substring.`,
  );
  lines.push(
    ``,
    `Before you submit, count the words in the passage paragraphs. If the total is below the minimum above, rewrite a longer passage rather than truncate.`,
    ``,
    `Return ONLY the JSON object described in the schema above. No prose, no markdown fences.`,
  );
  return lines.join("\n");
}

function validationAdvice(issue: ValidationIssue): string {
  switch (issue.code) {
    case "track.mismatch":
      return "Set the top-level track exactly to the requested track and follow that track's passage rules.";
    case "passage.too-short":
      return "Expand the passage paragraphs before returning JSON; Academic should land around 750-850 words and General Training around 550-700 words.";
    case "passage.too-long":
      return "Condense the passage paragraphs while preserving enough detail for the answers.";
    case "passage.missing-gt-context":
      return 'For General Training, include passage.gt_context as "social-survival", "workplace", or "general-reading".';
    case "passage.too-few-paragraphs":
    case "passage.too-many-paragraphs":
      return "Use exactly 5-7 paragraphs for Academic or 4-6 paragraphs for General Training.";
    case "passage.invalid-paragraph-labels":
      return 'Label paragraphs sequentially from "A" with no gaps or repeats.';
    case "questions.too-few":
    case "questions.too-many":
      return "Return 6-10 Reading questions total.";
    case "questions.non-contiguous-positions":
      return "Set question positions to 0, 1, 2, ... in display order with no gaps.";
    case "completion.answer-not-in-passage":
      return "For sentence-completion questions, every accepted answer must be a literal passage substring.";
    case "short-answer.answer-not-in-passage":
      return "For short-answer questions, every accepted answer must be a literal passage substring.";
    case "mcq.correct-not-grounded":
      return "Rewrite the correct MCQ option so it is clearly grounded in words, numbers, or facts present in the passage.";
  }
}

function validationRetryNudge(issues: ValidationIssue[]): string {
  const lines = [
    "Your previous JSON parsed, but failed the Reading content validator.",
    "Return a complete replacement JSON object, not a patch. Fix every issue below:",
  ];
  for (const issue of issues) {
    lines.push(
      `- ${issue.code}: ${issue.message} ${validationAdvice(issue)}`,
    );
  }
  lines.push(
    "Re-count the passage words, paragraph labels, question count, and question positions before returning.",
    "Return ONLY the corrected JSON object. No prose, no markdown fences.",
  );
  return lines.join("\n");
}

function validateForRequest(
  value: GeneratedReading,
  req: GenerateReadingRequest,
): ValidationResult {
  const validation = validateGeneratedReading(value);
  const issues = validation.ok ? [] : [...validation.issues];
  if (value.track !== req.track) {
    issues.push({
      code: "track.mismatch",
      message: `Model returned track ${value.track}, caller asked for ${req.track}.`,
    });
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

export function createReadingGenerator(deps: ReadingGeneratorDeps) {
  return {
    async generate(req: GenerateReadingRequest): Promise<GenerateReadingResult> {
      const system = deps.loadPrompt("reading");
      const turn1 = userTurn(req);
      const messages = seedMessages(turn1, req.revision);
      let last:
        | {
            text: string;
            model: string;
            usage: { input_tokens: number; output_tokens: number };
          }
        | null = null;

      for (let attempts = 1; attempts <= MAX_GENERATION_ATTEMPTS; attempts++) {
        last = await deps.ai.chat({
          ctx: req.ctx,
          purpose: "reading-generate",
          system,
          messages,
          maxTokens: MAX_OUTPUT_TOKENS,
        });

        const parsed = parseGeneratedReading(last.text);
        if (!parsed.ok) {
          if (attempts === MAX_GENERATION_ATTEMPTS) {
            throw new GenerationShapeError(parsed.issues, parsed.raw);
          }
          messages.push(
            { role: "assistant", content: last.text },
            { role: "user", content: STRICTER_RETRY_NUDGE },
          );
          continue;
        }

        const validation = validateForRequest(parsed.value, req);
        if (!validation.ok) {
          if (attempts === MAX_GENERATION_ATTEMPTS) {
            throw new GenerationValidationError(validation.issues);
          }
          messages.push(
            { role: "assistant", content: last.text },
            { role: "user", content: validationRetryNudge(validation.issues) },
          );
          continue;
        }

        return {
          value: parsed.value,
          model: last.model,
          usage: last.usage,
          attempts,
        };
      }

      throw new GenerationShapeError([], last?.text ?? "");
    },
  };
}

// Production singleton — wires the real gateway and the on-disk prompt.
export const readingGenerator = createReadingGenerator({
  ai: productionAi,
  loadPrompt: loadGenerationPrompt,
});
