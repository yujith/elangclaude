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
} from "./listening-schema";

export type ListeningValidationIssue = {
  code:
    | "track.mismatch"
    | "section.question-count-out-of-range"
    | "section.accent-variety-too-low"
    | "part.context-mismatch"
    | "part.question-count-out-of-range"
    | "part.invalid-speaker-role"
    | "part.speaker-pattern-mismatch"
    | "preview.incomplete-coverage"
    | "transcript.invalid-ielts-structure"
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
    | "completion-blank.slot-already-claimed"
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

const QUESTION_COUNT_RANGE = { min: 20, max: 32 } as const;
const PART_QUESTION_COUNT_RANGE = { min: 5, max: 8 } as const;
const PREVIEW_SECONDS_RANGE = { min: 20, max: 45 } as const;
const READING_PAUSE_SECONDS_RANGE = { min: 20, max: 45 } as const;
const EXPECTED_PART_CONTEXT: Record<1 | 2 | 3 | 4, "social" | "academic"> = {
  1: "social",
  2: "social",
  3: "academic",
  4: "academic",
};
const EXPECTED_SCENE_SPEAKERS: Record<1 | 2 | 3 | 4, { min: number; max: number }> = {
  1: { min: 2, max: 2 },
  2: { min: 1, max: 1 },
  3: { min: 2, max: 4 },
  4: { min: 1, max: 1 },
};

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

function normaliseCueText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function isNarrationLike(
  part: GeneratedListeningPart,
  index: number,
  pattern: RegExp,
): boolean {
  const segment = part.transcript[index];
  return (
    segment?.kind === "narration" &&
    pattern.test(normaliseCueText(segment.text))
  );
}

function checkIELTSPartContract(
  value: GeneratedListening,
  issues: ListeningValidationIssue[],
): void {
  if (
    value.questions.length < QUESTION_COUNT_RANGE.min ||
    value.questions.length > QUESTION_COUNT_RANGE.max
  ) {
    issues.push({
      code: "section.question-count-out-of-range",
      message: `Listening sections need ${QUESTION_COUNT_RANGE.min}-${QUESTION_COUNT_RANGE.max} questions; found ${value.questions.length}.`,
    });
  }

  const accents = new Set(
    value.parts.flatMap((part) => part.speakers.map((speaker) => speaker.accent)),
  );
  if (accents.size < 3) {
    issues.push({
      code: "section.accent-variety-too-low",
      message: `Listening sections should expose at least 3 distinct accents; found ${accents.size}.`,
    });
  }

  for (let pi = 0; pi < value.parts.length; pi += 1) {
    const part = value.parts[pi]!;
    const expectedContext = EXPECTED_PART_CONTEXT[part.part];
    if (part.context !== expectedContext) {
      issues.push({
        code: "part.context-mismatch",
        message: `Part ${part.part} must use the ${expectedContext} context, not ${part.context}.`,
        partIndex: pi,
      });
    }

    const partQuestionCount = part.question_positions.length;
    if (
      partQuestionCount < PART_QUESTION_COUNT_RANGE.min ||
      partQuestionCount > PART_QUESTION_COUNT_RANGE.max
    ) {
      issues.push({
        code: "part.question-count-out-of-range",
        message: `Part ${part.part} must contain ${PART_QUESTION_COUNT_RANGE.min}-${PART_QUESTION_COUNT_RANGE.max} question positions; found ${partQuestionCount}.`,
        partIndex: pi,
      });
    }

    if (part.speakers.some((speaker) => speaker.role === "examiner")) {
      issues.push({
        code: "part.invalid-speaker-role",
        message: `Part ${part.part} uses the examiner role, which is reserved for Speaking.`,
        partIndex: pi,
      });
    }

    const sceneSpeakerCount = part.speakers.filter(
      (speaker) => speaker.role === "speaker",
    ).length;
    const expectedSpeakers = EXPECTED_SCENE_SPEAKERS[part.part];
    if (
      sceneSpeakerCount < expectedSpeakers.min ||
      sceneSpeakerCount > expectedSpeakers.max
    ) {
      issues.push({
        code: "part.speaker-pattern-mismatch",
        message: `Part ${part.part} should have ${expectedSpeakers.min === expectedSpeakers.max ? expectedSpeakers.min : `${expectedSpeakers.min}-${expectedSpeakers.max}`} scene speaker(s); found ${sceneSpeakerCount}.`,
        partIndex: pi,
      });
    }

    if (
      !isNarrationLike(part, 0, new RegExp(`^part\\s+${part.part}\\b`)) ||
      !isNarrationLike(part, 1, /^you\s+will\s+hear\b/) ||
      !isNarrationLike(
        part,
        2,
        /^(first\s+)?you\s+have\s+some\s+time\s+to\s+look\s+at\s+questions\b/,
      ) ||
      part.transcript[3]?.kind !== "questions-preview" ||
      !isNarrationLike(
        part,
        4,
        /^now\s+listen\s+carefully\s+and\s+answer\s+questions\b/,
      )
    ) {
      issues.push({
        code: "transcript.invalid-ielts-structure",
        message:
          `Part ${part.part} must begin with the canonical IELTS scaffold: "Part ${part.part}.", "You will hear ...", preview cue, questions-preview, then "Now listen carefully ...".`,
        partIndex: pi,
      });
    }

    const previewSegment = part.transcript[3];
    if (
      previewSegment?.kind === "questions-preview" &&
      (previewSegment.seconds < PREVIEW_SECONDS_RANGE.min ||
        previewSegment.seconds > PREVIEW_SECONDS_RANGE.max)
    ) {
      issues.push({
        code: "transcript.invalid-ielts-structure",
        message: `Part ${part.part} questions-preview should last ${PREVIEW_SECONDS_RANGE.min}-${PREVIEW_SECONDS_RANGE.max} seconds; found ${previewSegment.seconds}.`,
        partIndex: pi,
        segmentIndex: 3,
      });
    }

    const endingCueIndex = part.transcript.length - 2;
    if (
      !isNarrationLike(
        part,
        endingCueIndex,
        new RegExp(
          `^that\\s+is\\s+the\\s+end\\s+of\\s+part\\s+${part.part}\\b.*check\\s+your\\s+answers`,
        ),
      )
    ) {
      issues.push({
        code: "transcript.invalid-ielts-structure",
        message: `Part ${part.part} must end with the canonical end-of-part check-your-answers narration.`,
        partIndex: pi,
        segmentIndex: endingCueIndex,
      });
    }

    const pauseSegment = part.transcript[part.transcript.length - 1];
    if (
      pauseSegment?.kind !== "reading-pause" ||
      pauseSegment.seconds < READING_PAUSE_SECONDS_RANGE.min ||
      pauseSegment.seconds > READING_PAUSE_SECONDS_RANGE.max
    ) {
      issues.push({
        code: "transcript.invalid-ielts-structure",
        message: `Part ${part.part} must end with a ${READING_PAUSE_SECONDS_RANGE.min}-${READING_PAUSE_SECONDS_RANGE.max} second reading-pause.`,
        partIndex: pi,
        segmentIndex: part.transcript.length - 1,
      });
    }

    const previewCoverage = new Set<number>();
    for (const segment of part.transcript) {
      if (segment.kind === "questions-preview") {
        for (const position of segment.question_positions) {
          previewCoverage.add(position);
        }
      }
    }
    const missingPreviewPositions = part.question_positions.filter(
      (position) => !previewCoverage.has(position),
    );
    if (missingPreviewPositions.length > 0) {
      issues.push({
        code: "preview.incomplete-coverage",
        message: `Part ${part.part} does not preview every question position. Missing: ${missingPreviewPositions.join(", ")}.`,
        partIndex: pi,
      });
    }
  }
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

function checkSlotClaims(
  value: GeneratedListening,
  issues: ListeningValidationIssue[],
): void {
  // Two questions referencing the same (block_id, slot_id) is a data
  // integrity bug — the learner sees the same blank twice with no way
  // to satisfy both. Surfaced here so the cleaner can drop the
  // duplicate.
  const seen = new Map<string, number>();
  for (let qi = 0; qi < value.questions.length; qi += 1) {
    const q = value.questions[qi]!;
    if (q.type !== "listening-completion-blank") continue;
    const key = `${q.correct_answer.block_id}::${q.correct_answer.slot_id}`;
    const firstClaim = seen.get(key);
    if (firstClaim === undefined) {
      seen.set(key, qi);
    } else {
      issues.push({
        code: "completion-blank.slot-already-claimed",
        message: `Slot ${q.correct_answer.slot_id} in block ${q.correct_answer.block_id} is already claimed by the question at index ${firstClaim} (position ${value.questions[firstClaim]!.position}).`,
        questionIndex: qi,
      });
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
  checkIELTSPartContract(value, issues);
  checkSpeakers(value.parts, issues);
  checkPreviewPositions(value.parts, issues);
  const { blockIndex } = checkBlocksAndSlots(value.parts, issues);
  checkQuestionPositions(value, issues);
  checkSlotClaims(value, issues);
  checkAnswerGrounding(value, blockIndex, issues);
  if (issues.length === 0) return { ok: true };
  return { ok: false, issues };
}

// ─── Cleaner ────────────────────────────────────────────────────────────
//
// LLMs occasionally invent a completion / sentence / short-answer
// accepted string that doesn't actually appear in their own transcript
// — usually 1-2 questions out of ~18. Rejecting the whole generation
// over those is wasteful when the rest is fine. cleanGeneratedListening
// drops the offending questions and their position references so the
// remaining content can validate + persist. Callers run it BEFORE
// validateGeneratedListening; anything the cleaner can drop becomes a
// no-op in the validator afterwards.
//
// What gets dropped:
//   - listening-sentence-completion / listening-short-answer where
//     none of the accepted strings are in the part transcript.
//   - listening-completion-blank where either the block/slot doesn't
//     resolve OR none of the accepted strings are in the transcript.
//
// MCQ kinds (single + multi) are never dropped — they have no
// grounding signal here (see ADR note in checkAnswerGrounding).

export type CleanResult = {
  cleaned: GeneratedListening;
  droppedQuestions: {
    position: number;
    type: string;
    reason:
      | "answer-not-in-transcript"
      | "completion-blank-block-not-found"
      | "completion-blank-slot-not-found"
      | "completion-blank-slot-already-claimed";
  }[];
};

export function cleanGeneratedListening(
  value: GeneratedListening,
): CleanResult {
  // Pre-compute haystacks + the block index so we don't recompute per
  // question.
  const haystacks = value.parts.map(partHaystack);
  const blockIndex = new Map<
    string,
    { partIndex: number; slotIds: Set<string> }
  >();
  for (let pi = 0; pi < value.parts.length; pi += 1) {
    const part = value.parts[pi]!;
    if (!part.completion_blocks) continue;
    for (const block of part.completion_blocks) {
      const slotIds = new Set<string>();
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const seg of cell) {
            if (seg.kind === "blank") slotIds.add(seg.slot_id);
          }
        }
      }
      blockIndex.set(block.id, { partIndex: pi, slotIds });
    }
  }

  const dropped: CleanResult["droppedQuestions"] = [];
  const droppedPositions = new Set<number>();
  // Track which (block_id, slot_id) tuples have already been claimed
  // by an earlier question so we can drop later duplicates instead of
  // shipping a test where two questions point at the same blank.
  const claimedSlots = new Set<string>();

  const keptQuestions = value.questions.filter((q) => {
    if (q.type === "listening-mcq-single" || q.type === "listening-mcq-multi") {
      return true;
    }
    const { partIndex } = findQuestionPart(value.parts, q.position);
    if (partIndex === -1) return true; // structural issue — let validator surface it
    const haystack = haystacks[partIndex]!;

    if (q.type === "listening-completion-blank") {
      const ref = blockIndex.get(q.correct_answer.block_id);
      if (!ref) {
        dropped.push({
          position: q.position,
          type: q.type,
          reason: "completion-blank-block-not-found",
        });
        droppedPositions.add(q.position);
        return false;
      }
      if (!ref.slotIds.has(q.correct_answer.slot_id)) {
        dropped.push({
          position: q.position,
          type: q.type,
          reason: "completion-blank-slot-not-found",
        });
        droppedPositions.add(q.position);
        return false;
      }
      const slotKey = `${q.correct_answer.block_id}::${q.correct_answer.slot_id}`;
      if (claimedSlots.has(slotKey)) {
        dropped.push({
          position: q.position,
          type: q.type,
          reason: "completion-blank-slot-already-claimed",
        });
        droppedPositions.add(q.position);
        return false;
      }
      claimedSlots.add(slotKey);
    }

    // Common grounding check for completion / sentence / short-answer.
    const accepted =
      q.type === "listening-sentence-completion" ||
      q.type === "listening-short-answer" ||
      q.type === "listening-completion-blank"
        ? q.correct_answer.accepted
        : null;
    if (!accepted) return true;

    const anyFound = accepted.some((a) => inHaystack(haystack, a));
    if (!anyFound) {
      dropped.push({
        position: q.position,
        type: q.type,
        reason: "answer-not-in-transcript",
      });
      droppedPositions.add(q.position);
      return false;
    }
    return true;
  });

  // Compute the FINAL set of question positions that survived the
  // filter. Anything in a part's question_positions (or in a
  // questions-preview segment) that ISN'T in this set is an "orphan"
  // — either because the cleaner just dropped it, OR because the
  // model declared a position in question_positions but never wrote
  // a question for it. Both cases get the same treatment: pruned.
  const survivingPositions = new Set<number>();
  for (const q of keptQuestions) survivingPositions.add(q.position);

  // The set of completion-block slots that a SURVIVING completion-blank
  // question actually claims (`block_id::slot_id`). Any blank in a layout
  // that isn't in here is an orphan — either the model over-declared slots,
  // or the cleaner just dropped the question that filled it (e.g. ungrounded
  // answer). We must strip those blanks from the layout below; otherwise the
  // runner renders them as "[missing slot: …]". NB: this is derived from
  // keptQuestions, not the earlier `claimedSlots`, because `claimedSlots`
  // also contains slots of questions that were later dropped for grounding.
  const keptSlots = new Set<string>();
  for (const q of keptQuestions) {
    if (q.type === "listening-completion-blank") {
      keptSlots.add(`${q.correct_answer.block_id}::${q.correct_answer.slot_id}`);
    }
  }

  // Build cleaned parts with non-surviving positions removed from
  // each part's question_positions AND from any questions-preview
  // segments. This catches the model's "I declared 5 question slots
  // but only wrote 4 questions" failure mode, which would otherwise
  // trip the positions.unreferenced-by-question validator.
  let didPrune = droppedPositions.size > 0;
  const cleanedParts = value.parts.map((part) => {
    const filteredPositions = part.question_positions.filter((p) =>
      survivingPositions.has(p),
    );
    if (filteredPositions.length !== part.question_positions.length) {
      didPrune = true;
    }
    const cleanedTranscript = part.transcript.map((seg) => {
      if (seg.kind !== "questions-preview") return seg;
      const filtered = seg.question_positions.filter((p) =>
        survivingPositions.has(p),
      );
      if (filtered.length !== seg.question_positions.length) {
        didPrune = true;
      }
      return { ...seg, question_positions: filtered };
    });

    // Strip orphan blanks from the completion-block layout so the runner
    // never shows "[missing slot]". A blank is an orphan when no surviving
    // completion-blank question claims its (block_id, slot_id). When pruning
    // a blank empties an answer row (a row that previously had a blank but no
    // longer does), drop the whole row so a dangling label doesn't linger;
    // drop a block entirely if it ends up with no rows.
    let cleanedBlocks = part.completion_blocks;
    if (part.completion_blocks) {
      const blocks: typeof part.completion_blocks = [];
      for (const block of part.completion_blocks) {
        const rows: typeof block.rows = [];
        for (const row of block.rows) {
          const hadBlank = row.cells.some((cell) =>
            cell.some((seg) => seg.kind === "blank"),
          );
          const cells = row.cells.map((cell) =>
            cell.filter(
              (seg) =>
                seg.kind !== "blank" ||
                keptSlots.has(`${block.id}::${seg.slot_id}`),
            ),
          );
          const stillHasBlank = cells.some((cell) =>
            cell.some((seg) => seg.kind === "blank"),
          );
          if (hadBlank && !stillHasBlank) {
            didPrune = true; // answer row lost its blank → drop the row
            continue;
          }
          if (cells.some((cell, ci) => cell.length !== row.cells[ci]!.length)) {
            didPrune = true;
          }
          rows.push({ ...row, cells });
        }
        if (rows.length === 0) {
          didPrune = true; // block emptied → drop it
          continue;
        }
        blocks.push({ ...block, rows });
      }
      cleanedBlocks = blocks;
    }

    return {
      ...part,
      question_positions: filteredPositions,
      transcript: cleanedTranscript,
      ...(part.completion_blocks
        ? { completion_blocks: cleanedBlocks }
        : {}),
    };
  });

  if (!didPrune) {
    return { cleaned: value, droppedQuestions: [] };
  }

  return {
    cleaned: { ...value, parts: cleanedParts, questions: keptQuestions },
    droppedQuestions: dropped,
  };
}
