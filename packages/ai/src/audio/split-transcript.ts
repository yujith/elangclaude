// Splits a Whisper transcript into per-IELTS-part chunks using runner-
// captured stage boundaries.
//
// The Speaking runner records timestamps (relative to the recording start)
// at each stage transition. We project Whisper segments onto those ranges
// so per-part grading can read the candidate's words for Part 1, Part 2,
// and Part 3 without the prep-minute silence in between.

import type { TranscriptSegment } from "./features";

export type PartRangeSec = {
  // Inclusive start; segments with `segment.start >= startSec` and
  // `segment.start < endSec` belong to this part. Times are in SECONDS.
  startSec: number;
  endSec: number;
};

export type PartTranscript = {
  text: string;
  segments: TranscriptSegment[];
};

export type SplitTranscriptResult = {
  part1: PartTranscript;
  part2: PartTranscript;
  part3: PartTranscript;
};

function inRange(seg: TranscriptSegment, r: PartRangeSec): boolean {
  return seg.start >= r.startSec && seg.start < r.endSec;
}

function packPart(segs: TranscriptSegment[]): PartTranscript {
  // Join segment texts with single spaces, trimming each. Whisper segments
  // often include leading/trailing whitespace.
  const text = segs
    .map((s) => s.text.trim())
    .filter((t) => t.length > 0)
    .join(" ");
  return { text, segments: segs };
}

export function splitTranscriptByParts(args: {
  segments: TranscriptSegment[];
  part1: PartRangeSec;
  // Part 2 covers the long turn + follow-up answers (the prep minute, where
  // the candidate is silent, is intentionally outside this range).
  part2: PartRangeSec;
  part3: PartRangeSec;
}): SplitTranscriptResult {
  const sorted = [...args.segments].sort((a, b) => a.start - b.start);
  return {
    part1: packPart(sorted.filter((s) => inRange(s, args.part1))),
    part2: packPart(sorted.filter((s) => inRange(s, args.part2))),
    part3: packPart(sorted.filter((s) => inRange(s, args.part3))),
  };
}
