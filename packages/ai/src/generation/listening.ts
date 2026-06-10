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
import { seedMessages, type GenerationRevision } from "./revision";
import {
  parseGeneratedListening,
  type GeneratedListening,
} from "./listening-schema";
import {
  cleanGeneratedListening,
  validateGeneratedListening,
  type CleanResult,
  type ListeningValidationIssue,
} from "./listening-validate";

// Listening output is significantly bigger than Reading — the script
// adds 4 parts of transcript prose plus the question array. 12000
// tokens gives the default model enough room for a chunked 4-part
// section. Real generations observed at ~7500–9500 output tokens; 12k
// is a safety margin.
const MAX_OUTPUT_TOKENS = 12000;
const MAX_GENERATION_ATTEMPTS = 3;

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
  // ADR-0024 automation: when the content reviewer rejected a previous
  // unit, seed the conversation with that unit + the reviewer's feedback
  // so the regeneration is a targeted fix rather than a blind re-roll.
  revision?: GenerationRevision;
};

export type GenerateListeningResult = {
  value: GeneratedListening;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  attempts: number;
  // Questions the cleaner dropped before validation (typically 0-2 per
  // generation). Surfaced so the SuperAdmin moderation UI can show
  // "we kept 17 / 19" and the operator can decide if the trimmed
  // section is acceptable.
  droppedQuestions: CleanResult["droppedQuestions"];
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
    `Generate one IELTS Listening section (4 parts, 20-32 questions total).`,
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
    `- Each part needs 5-8 questions.`,
    `- Part 1 = social with 2 scene speakers; Part 2 = social with 1 scene speaker; Part 3 = academic with 2-4 scene speakers; Part 4 = academic with 1 scene speaker.`,
    `- Each part transcript must open with "Part N.", then "You will hear ...", then a preview cue, a questions-preview segment, and "Now listen carefully ..."; it must end with the end-of-part check cue and a reading-pause.`,
    `- Every accepted answer string for completion / sentence / short-answer questions MUST appear in the parent part's transcript.`,
    `- Slot ids globally unique across all completion_blocks.`,
    `- Question positions globally unique; each appears in exactly one part's question_positions.`,
    `- mcq-multi is ONE Question row with pick_count = correct.length.`,
    `- Use only narrator/speaker roles and cover at least three accents across the full section.`,
    ``,
    `Return ONLY the JSON object described in the schema above. No prose, no markdown fences.`,
  );
  return lines.join("\n");
}

function validationAdvice(issue: ListeningValidationIssue): string {
  switch (issue.code) {
    case "track.mismatch":
      return "Set the top-level track exactly to the requested track.";
    case "section.question-count-out-of-range":
      return "Keep the full section between 20 and 32 question rows total.";
    case "part.question-count-out-of-range":
      return "Give every part exactly 5-8 question positions; redistribute or remove excess questions before returning JSON.";
    case "section.accent-variety-too-low":
      return "Use at least three distinct accent values across the full section.";
    case "part.context-mismatch":
    case "part.invalid-speaker-role":
    case "part.speaker-pattern-mismatch":
      return "Match each part's IELTS role pattern: Part 1 two social speakers, Part 2 one social speaker, Part 3 two to four academic speakers, Part 4 one academic speaker.";
    case "preview.incomplete-coverage":
    case "preview.position-outside-part":
      return "Make each questions-preview segment cover only positions that belong to its own part.";
    case "transcript.invalid-ielts-structure":
      return 'Each transcript must open with "Part N.", include preview and listening cues, and end with the end-of-part check cue plus a reading-pause.';
    case "positions.duplicate-on-question":
    case "positions.in-multiple-parts":
    case "positions.unreferenced-by-question":
    case "positions.question-not-in-any-part":
      return "Make question positions globally unique and ensure each position appears in exactly one part's question_positions.";
    case "speakers.duplicate-id":
    case "speakers.unknown-speech-reference":
      return "Use unique speaker ids and reference only speakers declared in the same part.";
    case "blocks.duplicate-id":
    case "slots.duplicate-id":
    case "completion-blank.block-not-found":
    case "completion-blank.slot-not-found":
    case "completion-blank.slot-already-claimed":
      return "Keep completion block ids and slot ids unique, and ensure every completion-blank question references an existing unclaimed slot.";
    case "answer.not-in-transcript":
      return "For completion, sentence-completion, and short-answer questions, every accepted answer must appear literally in the parent part transcript.";
  }
}

function validationRetryNudge(issues: ListeningValidationIssue[]): string {
  const lines = [
    "Your previous JSON parsed, but failed the Listening content validator.",
    "Return a complete replacement JSON object, not a patch. Fix every issue below:",
  ];
  for (const issue of issues) {
    lines.push(`- ${issue.code}: ${issue.message} ${validationAdvice(issue)}`);
  }
  lines.push(
    "Before returning, recount: 4 parts, 5-8 question positions per part, 20-32 total question rows, globally unique positions, and answers grounded in the transcript.",
    "Return ONLY the corrected JSON object. No prose, no markdown fences.",
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
          purpose: "listening-generate",
          system,
          messages,
          maxTokens: MAX_OUTPUT_TOKENS,
        });

        const parsed = parseGeneratedListening(last.text);
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

        // Clean BEFORE validating. The cleaner drops completion-style
        // questions whose accepted answers don't appear in the transcript
        // — that's a common 1-2 per ~18 LLM hiccup. Anything the cleaner
        // removes won't trip the validator's answer.not-in-transcript
        // check. Real structural issues (positions, speakers, slot
        // references) still surface.
        const cleanResult = cleanGeneratedListening(parsed.value);

        const validation = validateGeneratedListening(cleanResult.cleaned);
        const issues = validation.ok ? [] : [...validation.issues];

        // Cross-check the requested track matches what the model produced.
        // Listening content is track-agnostic in practice (ADR 0006-style
        // reasoning), but the caller asked for a specific tag and a
        // mismatch suggests the model misread the prompt — a re-roll
        // signal, not a silent rewrite.
        if (cleanResult.cleaned.track !== req.track) {
          issues.push({
            code: "track.mismatch",
            message: `Model returned track ${cleanResult.cleaned.track}, caller asked for ${req.track}.`,
          });
        }

        if (issues.length > 0) {
          if (attempts === MAX_GENERATION_ATTEMPTS) {
            throw new GenerationValidationError(issues);
          }
          messages.push(
            { role: "assistant", content: last.text },
            { role: "user", content: validationRetryNudge(issues) },
          );
          continue;
        }

        return {
          value: cleanResult.cleaned,
          model: last.model,
          usage: last.usage,
          attempts,
          droppedQuestions: cleanResult.droppedQuestions,
        };
      }

      throw new GenerationShapeError([], last?.text ?? "");
    },
  };
}

// Production singleton — wires the real gateway and the on-disk prompt.
export const listeningGenerator = createListeningGenerator({
  ai: productionAi,
  loadPrompt: loadGenerationPrompt,
});
