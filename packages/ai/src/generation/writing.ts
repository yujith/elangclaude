// Writing generation pipeline.
//
// Composes the AI gateway with the canonical generation prompt to
// produce a validated `GeneratedWriting` for a (task_kind, track,
// difficulty) request.
//
// Structure mirrors createReadingGenerator: a factory accepting
// injectable deps, plus a production singleton wired to the real
// gateway + on-disk prompt. Tests instantiate the factory with mocks
// and never hit the network.
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
import type { WritingTaskKind } from "../grading/prompts";
import {
  loadGenerationPrompt,
  type GenerationPromptLoader,
} from "./prompts";
import { seedMessages, type GenerationRevision } from "./revision";
import {
  parseGeneratedWriting,
  type GeneratedWriting,
} from "./writing-schema";
import { validateGeneratedWriting } from "./writing-validate";

const MAX_OUTPUT_TOKENS = 2000;
const STRICTER_RETRY_NUDGE =
  "Your previous response was not valid JSON or did not match the required schema. " +
  "Return ONLY a single JSON object that matches the schema for the requested task_kind. " +
  "No prose, no markdown fences, no preamble.";

export type GenerateWritingRequest = {
  ctx: OrgContext;
  taskKind: WritingTaskKind;
  // Required for `writing-task-2` (Academic or General Training). For the
  // two Task 1 kinds the track is implied — Academic for
  // `writing-task-1-academic`, General Training for
  // `writing-task-1-general` — and this field, if passed, must agree.
  track?: "Academic" | "GeneralTraining";
  // Difficulty 1–5, mapping ~5.0 / 6.0 / 6.5 / 7.0 / 8.0.
  difficulty: number;
  // Optional topic hint passed to the model. Useful when re-rolling to
  // avoid generating two tasks on the same subject.
  topicHint?: string;
  // ADR-0024 automation: when the content reviewer rejected a previous
  // unit, seed the conversation with that unit + the reviewer's feedback
  // so the regeneration is a targeted fix rather than a blind re-roll.
  revision?: GenerationRevision;
};

export type GenerateWritingResult = {
  value: GeneratedWriting;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  attempts: number;
};

type ChatFn = (req: {
  ctx: OrgContext;
  purpose: "writing-generate";
  messages: { role: "user" | "assistant"; content: string }[];
  system?: string;
  maxTokens: number;
}) => Promise<{
  text: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}>;

export type WritingGeneratorDeps = {
  ai: { chat: ChatFn };
  loadPrompt: GenerationPromptLoader;
};

// The track each task_kind is fixed to, or null when the caller must
// choose (Task 2 runs on both tracks).
function impliedTrack(
  taskKind: WritingTaskKind,
): "Academic" | "GeneralTraining" | null {
  switch (taskKind) {
    case "writing-task-1-academic":
      return "Academic";
    case "writing-task-1-general":
      return "GeneralTraining";
    case "writing-task-2":
      return null;
  }
}

// Resolve the track the model should target, reconciling the implied
// track with anything the caller passed. Throws on a contradiction so a
// misconfigured caller fails loudly rather than generating off-track.
function resolveTrack(req: GenerateWritingRequest): "Academic" | "GeneralTraining" {
  const implied = impliedTrack(req.taskKind);
  if (implied !== null) {
    if (req.track && req.track !== implied) {
      throw new Error(
        `Task kind ${req.taskKind} is ${implied}-only, but caller asked for ${req.track}.`,
      );
    }
    return implied;
  }
  // writing-task-2 — the caller must specify.
  if (!req.track) {
    throw new Error("writing-task-2 requires an explicit track.");
  }
  return req.track;
}

function trackLabel(track: "Academic" | "GeneralTraining"): string {
  return track === "Academic" ? "Academic" : "General Training";
}

function userTurn(
  req: GenerateWritingRequest,
  track: "Academic" | "GeneralTraining",
): string {
  const lines: string[] = [
    `Generate one IELTS Writing practice task.`,
    ``,
    `Task kind: ${req.taskKind}`,
    `Track: ${trackLabel(track)}`,
    `Difficulty: ${req.difficulty} (1=easy ~band 5.0, 5=hard ~band 8.0)`,
  ];
  if (req.topicHint && req.topicHint.length > 0) {
    lines.push(``, `Topic hint: ${req.topicHint}`);
  }
  lines.push(``, `Reminders:`);
  switch (req.taskKind) {
    case "writing-task-1-academic":
      lines.push(
        `- Use the canonical Academic Task 1 instruction sentence verbatim.`,
        `- Keep the visual preamble to 1-2 short sentences.`,
        `- Keep the visual inside IELTS-style ranges: bar/line 2-5 series and 3-7 categories, pie 3-6 slices, table 3-5 columns and 3-8 rows, process 4-7 steps.`,
      );
      break;
    case "writing-task-1-general":
      lines.push(
        `- Use exactly three bullets, the no-addresses line, the "Begin your letter as follows:" line, and a salutation that matches the register.`,
        `- End Task 1 with the exact line "Write at least 150 words."`,
      );
      break;
    case "writing-task-2":
      lines.push(
        `- Use the subtype-specific question instruction verbatim.`,
        `- End with the full "Give reasons for your answer and include any relevant examples from your own knowledge or experience." line before the exact 250-word target.`,
      );
      break;
  }
  lines.push(
    ``,
    `Return ONLY the JSON object described in the schema above for this task_kind. No prose, no markdown fences.`,
  );
  return lines.join("\n");
}

export function createWritingGenerator(deps: WritingGeneratorDeps) {
  return {
    async generate(
      req: GenerateWritingRequest,
    ): Promise<GenerateWritingResult> {
      const track = resolveTrack(req);
      const system = deps.loadPrompt("writing");
      const turn1 = userTurn(req, track);
      const baseMessages = seedMessages(turn1, req.revision);

      const first = await deps.ai.chat({
        ctx: req.ctx,
        purpose: "writing-generate",
        system,
        messages: baseMessages,
        maxTokens: MAX_OUTPUT_TOKENS,
      });

      let parsed = parseGeneratedWriting(first.text);
      let attempts = 1;
      let last = first;

      if (!parsed.ok) {
        // One retry, including the model's own malformed output so it can
        // see and fix it. Mirrors the readingGenerator pattern.
        const second = await deps.ai.chat({
          ctx: req.ctx,
          purpose: "writing-generate",
          system,
          messages: [
            ...baseMessages,
            { role: "assistant", content: first.text },
            { role: "user", content: STRICTER_RETRY_NUDGE },
          ],
          maxTokens: MAX_OUTPUT_TOKENS,
        });
        attempts = 2;
        last = second;
        parsed = parseGeneratedWriting(second.text);
        if (!parsed.ok) {
          throw new GenerationShapeError(parsed.issues, parsed.raw);
        }
      }

      // Cross-check the model produced the task_kind and track the
      // caller asked for. The schema allows all three kinds and both
      // tracks; mismatch against the request is a re-roll-worthy
      // content failure.
      if (parsed.value.task_kind !== req.taskKind) {
        throw new GenerationValidationError([
          {
            code: "prompt.missing-instruction",
            message: `Model returned task_kind ${parsed.value.task_kind}, caller asked for ${req.taskKind}.`,
          },
        ]);
      }
      if (parsed.value.track !== track) {
        throw new GenerationValidationError([
          {
            code: "prompt.missing-instruction",
            message: `Model returned track ${parsed.value.track}, caller asked for ${track}.`,
          },
        ]);
      }

      // Semantic validator. Does not retry: a re-roll is the caller's
      // decision, not the generator's.
      const validation = validateGeneratedWriting(parsed.value);
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
export const writingGenerator = createWritingGenerator({
  ai: productionAi,
  loadPrompt: loadGenerationPrompt,
});
