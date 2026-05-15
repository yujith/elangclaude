import { describe, expect, it } from "vitest";
import { extractAudioFeatures, type TranscriptSegment } from "./features";

function seg(start: number, end: number, text: string): TranscriptSegment {
  return { start, end, text };
}

describe("extractAudioFeatures", () => {
  it("returns zeros for an empty transcript", () => {
    const f = extractAudioFeatures({ segments: [], duration_sec: 0 });
    expect(f).toEqual({
      duration_sec: 0,
      total_words: 0,
      wpm: 0,
      pause_count: 0,
      mean_pause_ms: 0,
      longest_pause_ms: 0,
      speaking_ratio: 0,
    });
  });

  it("computes wpm against the recording duration, not speaking time", () => {
    // 30 words in a 60-second recording → 30 wpm. Even if only 30 seconds
    // were actually spoken, wpm is relative to the test duration.
    const text = "one two three four five six seven eight nine ten ".repeat(3);
    const f = extractAudioFeatures({
      segments: [seg(0, 30, text)],
      duration_sec: 60,
    });
    expect(f.total_words).toBe(30);
    expect(f.wpm).toBe(30);
    expect(f.speaking_ratio).toBe(0.5);
  });

  it("counts pauses only at or above the 500 ms threshold", () => {
    // Gaps: 200ms (sub-threshold), 800ms (counted), 1500ms (counted).
    const f = extractAudioFeatures({
      segments: [
        seg(0, 1.0, "first"),
        seg(1.2, 2.0, "second"), // 200ms gap → not a pause
        seg(2.8, 3.5, "third"), // 800ms gap → pause
        seg(5.0, 6.0, "fourth"), // 1500ms gap → pause
      ],
      duration_sec: 6,
    });
    expect(f.pause_count).toBe(2);
    expect(f.mean_pause_ms).toBe(1150); // (800 + 1500) / 2
    expect(f.longest_pause_ms).toBe(1500);
  });

  it("ignores tiny segment ordering noise (sorts defensively)", () => {
    const f = extractAudioFeatures({
      segments: [seg(2, 3, "later"), seg(0, 1, "earlier")],
      duration_sec: 3,
    });
    // 1s gap between the (sorted) segments → 1 pause.
    expect(f.pause_count).toBe(1);
    expect(f.longest_pause_ms).toBe(1000);
  });

  it("rounds wpm to one decimal", () => {
    // 7 words / 13 seconds * 60 = 32.307...
    const f = extractAudioFeatures({
      segments: [seg(0, 13, "one two three four five six seven")],
      duration_sec: 13,
    });
    expect(f.wpm).toBe(32.3);
  });

  it("reports a speaking_ratio bounded to two decimals", () => {
    const f = extractAudioFeatures({
      segments: [seg(0, 2.5, "hello there friend")],
      duration_sec: 10,
    });
    expect(f.speaking_ratio).toBe(0.25);
  });
});
