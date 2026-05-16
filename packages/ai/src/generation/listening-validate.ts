// Semantic validator for generated Listening content.
//
// The Zod schema (`listening-schema.ts`) catches structural mistakes —
// wrong types, missing fields, out-of-range numbers, unrecognised
// question kinds. This module catches the content mistakes that the
// schema cannot:
//
//   - Question.position values that don't appear in any part's
//     question_positions, or that appear in more than one part.
//   - completion-blank questions whose (block_id, slot_id) don't
//     reference an existing block + slot.
//   - completion / sentence / short-answer accepted strings that aren't
//     a substring of the parent part's transcript.
//   - speech segments referencing a speaker id that wasn't defined in
//     the same part.
//   - slot ids reused across blocks (must be globally unique within the
//     section).
//   - questions-preview segments pointing at positions outside the
//     enclosing part.
//
// A failure rejects the whole generation; the caller re-rolls. The
// returned issue codes are stable so the SuperAdmin moderation UI and
// telemetry dashboards can group on them.

import { softNormalize } from "../reading/normalize";
import type {
  GeneratedListening,
  GeneratedListeningPart,
  GeneratedListeningQuestion,
} from "./listening-schema";

export type ListeningValidationIssue = {
  code:
    | "positions.duplicate-on-question"
    | "positions.in-multiple-parts"
    | "positions.unreferenced-by-question"
    | "positions.question-not-in-any-part"
    | "preview.position-outside-part"
    | "speakers.duplicate-id"
    | "speakers.unknown-speech-reference"
    | "blocks.duplicate-id"
    | "slots.duplicate-id"
    | "completion-blank.block-not-found"
    | "completion-blank.slot-not-found"
    | "answer.not-in-transcript";
  message: string;
  // Indices into the input shape, when applicable. Surfaced so the
  // moderation UI can highlight the offending row.
  partIndex?: number;
  questionIndex?: number;
  segmentIndex?: number;
};

export type ListeningValidationResult =
  | { ok: true }
  | { ok: false; issues: ListeningValidationIssue[] };

// ─── Helpers ────────────────────────────────────────────────────────────

function partHaystack(part: GeneratedListeningPart): string {
  // Concatenate every speech.text + narration.text in the part into one
  // soft-normalised haystack used for substring checks. We do NOT include
  // reading-pause.instruction text, because that is UI-only (silent
  // audio), not something the recording carries.
  const parts: string[] = [];
  for (const seg of part.transcript) {
    if (seg.kind === "speech" || seg.kind === "narration") {
      parts.push(seg.text);
    }
  }
  return softNormalize(parts.join("\n"));
}

function inHaystack(haystack: string, needle: string): boolean {
  const n = softNormalize(needle);
  if (n.length === 0) return false;
  return haystack.includes(n);
}

function findQuestionPart(
  parts: GeneratedListeningPart[],
  position: number,
): { partIndex: number; ambiguous: boolean } {
  let partIndex = -1;
  let ambiguous = false;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]!.question_positions.includes(position)) {
      if (partIndex !== -1) ambiguous = true;
      partIndex = i;
    }
  }
  return { partIndex, ambiguous };
}

// ─── Per-aspect validators ──────────────────────────────────────────────

function checkSpeakers(
  parts: GeneratedListeningPart[],
  issues: ListeningValidationIssue[],
): void {
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi]!;
    const seen = new Set<string>();
    const ids = new Set<string>();
    for (const sp of part.speakers) {
      if (seen.has(sp.id)) {
        issues.push({
          code: "speakers.duplicate-id",
          message: `Speaker id "${sp.id}" appears twice in part ${pi + 1}.`,
          partIndex: pi,
        });
      }
      seen.add(sp.id);
      ids.add(sp.id);
    }
    for (let si = 0; si < part.transcript.length; si++) {
      const seg = part.transcript[si]!;
      if (seg.kind === "speech" && !ids.has(seg.speaker_id)) {
        issues.push({
          code: "speakers.unknown-speech-reference",
          message: `Speech segment in part ${pi + 1} references undefined speaker "${seg.speaker_id}".`,
          partIndex: pi,
          segmentIndex: si,
        });
      }
    }
  }
}

function checkPreviewPositions(
  parts: GeneratedListeningPart[],
  issues: ListeningValidationIssue[],
): void {
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi]!;
    const ownSet = new Set(part.question_positions);
    for (let si = 0; si < part.transcript.length; si++) {
      const seg = part.transcript[si]!;
      if (seg.kind === "questions-preview") {
        for (const pos of seg.question_positions) {
          if (!ownSet.has(pos)) {
            issues.push({
              code: "preview.position-outside-part",
              message: `Part ${pi + 1} questions-preview previews position ${pos}, which isn't in this part.`,
              partIndex: pi,
              segmentIndex: si,
            });
          }
        }
      }
    }
  }
}

function checkBlocksAndSlots(
  parts: GeneratedListeningPart[],
  issues: ListeningValidationIssue[],
): {
  blockIndex: Map<string, { partIndex: number; slotIds: Set<string> }>;
} {
  const blockIndex = new Map<
    string,
    { partIndex: number; slotIds: Set<string> }
  >();
  const seenSlot = new Set<string>();
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi]!;
    if (!part.completion_blocks) continue;
    const seenBlock = new Set<string>();
    for (const block of part.completion_blocks) {
      if (blockIndex.has(block.id) || seenBlock.has(block.id)) {
        issues.push({
          code: "blocks.duplicate-id",
          message: `Completion block id "${block.id}" appears more than once (part ${pi + 1}).`,
          partIndex: pi,
        });
      }
      seenBlock.add(block.id);
      const slotIds = new Set<string>();
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const seg of cell) {
            if (seg.kind === "blank") {
              if (seenSlot.has(seg.slot_id)) {
                issues.push({
                  code: "slots.duplicate-id",
                  message: `Slot id "${seg.slot_id}" appears in more than one completion block.`,
                  partIndex: pi,
                });
              }
              seenSlot.add(seg.slot_id);
              slotIds.add(seg.slot_id);
            }
          }
        }
      }
      blockIndex.set(block.id, { partIndex: pi, slotIds });
    }
  }
  return { blockIndex };
}

function checkQuestionPositions(
  value: GeneratedListening,
  issues: ListeningValidationIssue[],
): void {
  const seenOnQuestion = new Set<number>();
  for (let qi = 0; qi < value.questions.length; qi++) {
    const q = value.questions[qi]!;
    if (seenOnQuestion.has(q.position)) {
      issues.push({
        code: "positions.duplicate-on-question",
        message: `Position ${q.position} appears on more than one Question row.`,
        questionIndex: qi,
      });
    }
    seenOnQuestion.add(q.position);
    const { partIndex, ambiguous } = findQuestionPart(value.parts, q.position);
    if (partIndex === -1) {
      issues.push({
        code: "positions.question-not-in-any-part",
        message: `Question position ${q.position} doesn't appear in any part's question_positions.`,
        questionIndex: qi,
      });
    } else if (ambiguous) {
      issues.push({
        code: "positions.in-multiple-parts",
        message: `Question position ${q.position} is claimed by more than one part.`,
        questionIndex: qi,
      });
    }
  }
  // Every part-claimed position should have a Question row backing it,
  // otherwise the runner has orphans.
  for (let pi = 0; pi < value.parts.length; pi++) {
    const part = value.parts[pi]!;
    for (const pos of part.question_positions) {
      if (!seenOnQuestion.has(pos)) {
        issues.push({
          code: "positions.unreferenced-by-question",
          message: `Part ${pi + 1} declares position ${pos} but no Question row exists for it.`,
          partIndex: pi,
        });
      }
    }
  }
}

function checkAnswerGrounding(
  value: GeneratedListening,
  blockIndex: Map<string, { partIndex: number; slotIds: Set<string> }>,
  issues: ListeningValidationIssue[],
): void {
  // Pre-compute haystacks per part.
  const haystacks = value.parts.map(partHaystack);
  for (let qi = 0; qi < value.questions.length; qi++) {
    const q = value.questions[qi]!;
    const { partIndex } = findQuestionPart(value.parts, q.position);
    if (partIndex === -1) continue; // already reported above
    const haystack = haystacks[partIndex]!;

    if (
      q.type === "listening-sentence-completion" ||
      q.type === "listening-short-answer"
    ) {
      let anyFound = false;
      for (const accepted of q.correct_answer.accepted) {
        if (inHaystack(haystack, accepted)) {
          anyFound = true;
          break;
        }
      }
      if (!anyFound) {
        issues.push({
          code: "answer.not-in-transcript",
          message: `Question at position ${q.position}: no accepted answer found in part ${partIndex + 1}'s transcript.`,
          questionIndex: qi,
          partIndex,
        });
      }
    } else if (q.type === "listening-completion-blank") {
      const blockRef = blockIndex.get(q.correct_answer.block_id);
      if (!blockRef) {
        issues.push({
          code: "completion-blank.block-not-found",
          message: `Question at position ${q.position} references unknown block_id "${q.correct_answer.block_id}".`,
          questionIndex: qi,
        });
      } else if (!blockRef.slotIds.has(q.correct_answer.slot_id)) {
        issues.push({
          code: "completion-blank.slot-not-found",
          message: `Question at position ${q.position} references unknown slot_id "${q.correct_answer.slot_id}" in block "${q.correct_answer.block_id}".`,
          questionIndex: qi,
        });
      }
      // Also enforce answer grounding for completion-blank — same rule as
      // sentence-completion / short-answer.
      let anyFound = false;
      for (const accepted of q.correct_answer.accepted) {
        if (inHaystack(haystack, accepted)) {
          anyFound = true;
          break;
        }
      }
      if (!anyFound) {
        issues.push({
          code: "answer.not-in-transcript",
          message: `Completion-blank at position ${q.position}: no accepted answer found in part ${partIndex + 1}'s transcript.`,
          questionIndex: qi,
          partIndex,
        });
      }
    }
    // listening-mcq-single / -mcq-multi: we do NOT enforce token-overlap
    // grounding here. Listening MCQ options are interpretive paraphrases
    // ("What concerns the tutor?" → "Methodology" — the speaker said
    // "the methodology is quite specialised," but the option summarises
    // it as one word). The token-overlap heuristic was carried over from
    // Reading where short dense passages make it reliable; on Listening
    // transcripts it produced false positives almost every run.
    // Hallucination protection is the SuperAdmin moderation queue, not
    // a string-match heuristic.
  }
}

// ─── Entry point ────────────────────────────────────────────────────────

export function validateGeneratedListening(
  value: GeneratedListening,
): ListeningValidationResult {
  const issues: ListeningValidationIssue[] = [];
  checkSpeakers(value.parts, issues);
  checkPreviewPositions(value.parts, issues);
  const { blockIndex } = checkBlocksAndSlots(value.parts, issues);
  checkQuestionPositions(value, issues);
  checkAnswerGrounding(value, blockIndex, issues);
  if (issues.length === 0) return { ok: true };
  return { ok: false, issues };
}
