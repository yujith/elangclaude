// IELTS Academic Reading raw → band conversion table.
//
// Source: the published IDP / British Council conversion (40-question
// section). Bands are 0–9 in half-band increments; we ship Academic in
// Phase 1 and add the GT table (different raw thresholds) when the GT
// picker lands.
//
// A v1 practice unit is a single ~13-question passage, not a 40-question
// section. We scale the raw count to a 40-question equivalent before
// looking it up, and surface the band as "approximate" in the UI copy.
// This is a calibration cue, not an examiner-equivalent score.

export type Track = "Academic" | "GeneralTraining";

// Each entry: [minimum raw score out of 40, IELTS band].
// Descending order so the first match wins.
const ACADEMIC_TABLE: ReadonlyArray<readonly [number, number]> = [
  [39, 9.0],
  [37, 8.5],
  [35, 8.0],
  [33, 7.5],
  [30, 7.0],
  [27, 6.5],
  [23, 6.0],
  [19, 5.5],
  [15, 5.0],
  [13, 4.5],
  [10, 4.0],
  [8, 3.5],
  [6, 3.0],
  [4, 2.5],
  [0, 0.0],
];

// Stub for GT — wired up in Phase 7. Throws so a caller can't silently
// score a GT learner against the Academic curve.
const GENERAL_TABLE: ReadonlyArray<readonly [number, number]> = [
  [40, 9.0],
  [39, 8.5],
  [37, 8.0],
  [36, 7.5],
  [34, 7.0],
  [32, 6.5],
  [30, 6.0],
  [27, 5.5],
  [23, 5.0],
  [19, 4.5],
  [15, 4.0],
  [12, 3.5],
  [9, 3.0],
  [6, 2.5],
  [0, 0.0],
];

export function bandFromRaw40(track: Track, raw: number): number {
  const table = track === "Academic" ? ACADEMIC_TABLE : GENERAL_TABLE;
  const clamped = Math.max(0, Math.min(40, Math.round(raw)));
  for (const [threshold, band] of table) {
    if (clamped >= threshold) return band;
  }
  return 0;
}

// Scale a partial-section raw score (e.g. 8 out of 13) to its 40-question
// equivalent so the conversion table applies. Rounds to nearest integer.
// total ≤ 0 returns 0 to avoid divide-by-zero.
export function scaleRawTo40(correct: number, total: number): number {
  if (total <= 0) return 0;
  const scaled = (correct / total) * 40;
  return Math.max(0, Math.min(40, Math.round(scaled)));
}

export function bandFromPartial(track: Track, correct: number, total: number): number {
  return bandFromRaw40(track, scaleRawTo40(correct, total));
}
