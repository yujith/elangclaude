import { describe, expect, it } from "vitest";
import {
  splitTranscriptByParts,
  type PartRangeSec,
} from "./split-transcript";
import type { TranscriptSegment } from "./features";

function seg(start: number, end: number, text: string): TranscriptSegment {
  return { start, end, text };
}

const PART1: PartRangeSec = { startSec: 0, endSec: 30 };
// Part 2 starts AFTER the 30s prep minute would end (in real timings it's
// 90s long but the test boundaries are arbitrary — we trust the runner).
const PART2: PartRangeSec = { startSec: 90, endSec: 180 };
const PART3: PartRangeSec = { startSec: 180, endSec: 360 };

describe("splitTranscriptByParts", () => {
  it("buckets segments by start time", () => {
    const segments = [
      seg(1, 5, "part one a"),
      seg(20, 28, "part one b"),
      seg(40, 60, "during silent prep"),   // outside any part — dropped
      seg(100, 110, "long turn opens"),
      seg(150, 170, "more long turn"),
      seg(200, 210, "part three discussion"),
    ];
    const out = splitTranscriptByParts({
      segments,
      part1: PART1,
      part2: PART2,
      part3: PART3,
    });
    expect(out.part1.text).toBe("part one a part one b");
    expect(out.part2.text).toBe("long turn opens more long turn");
    expect(out.part3.text).toBe("part three discussion");
    expect(out.part1.segments).toHaveLength(2);
    expect(out.part2.segments).toHaveLength(2);
    expect(out.part3.segments).toHaveLength(1);
  });

  it("drops segments that fall between parts (e.g. the prep minute)", () => {
    const segments = [seg(50, 70, "mumbled during prep")];
    const out = splitTranscriptByParts({
      segments,
      part1: PART1,
      part2: PART2,
      part3: PART3,
    });
    expect(out.part1.text).toBe("");
    expect(out.part2.text).toBe("");
    expect(out.part3.text).toBe("");
  });

  it("sorts defensively before bucketing", () => {
    const out = splitTranscriptByParts({
      segments: [seg(200, 210, "third"), seg(1, 5, "first"), seg(100, 110, "second")],
      part1: PART1,
      part2: PART2,
      part3: PART3,
    });
    expect(out.part1.segments[0]?.text).toBe("first");
    expect(out.part2.segments[0]?.text).toBe("second");
    expect(out.part3.segments[0]?.text).toBe("third");
  });

  it("uses start-time membership — a segment straddling a boundary lands by start", () => {
    // segment.start = 25 is in part1; its end at 35 doesn't matter.
    const out = splitTranscriptByParts({
      segments: [seg(25, 35, "straddler")],
      part1: PART1,
      part2: PART2,
      part3: PART3,
    });
    expect(out.part1.text).toBe("straddler");
    expect(out.part2.text).toBe("");
  });

  it("trims each segment text before joining", () => {
    const out = splitTranscriptByParts({
      segments: [seg(0, 2, "  hello "), seg(3, 5, " world")],
      part1: PART1,
      part2: PART2,
      part3: PART3,
    });
    expect(out.part1.text).toBe("hello world");
  });
});
