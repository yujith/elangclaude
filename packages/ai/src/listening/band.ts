// IELTS Listening raw → band conversion.
//
// The published IDP / British Council Listening table is shared across
// Academic and General Training tracks — unlike Reading where the GT
// table is more lenient. We still accept a `track` parameter for API
// symmetry with reading/band.ts; both arguments route to the same table.
//
// Source: published Cambridge / IDP conversion tables (40-question
// section). Bands are 0–9 in half-band increments.
//
// A v1 Listening practice unit is the full ~20-32 question section we
// generate; raw scores are scaled to a 40-question equivalent (the
// dimension the table is calibrated to) before lookup. The UI surfaces
// the band as "approximate" when the scaling factor is non-trivial.

export type Track = "Academic" | "GeneralTraining";

// [minimum raw score out of 40, IELTS band].
// Descending order so the first match wins.
const LISTENING_TABLE: ReadonlyArray<readonly [number, number]> = [
  [39, 9.0],
  [37, 8.5],
  [35, 8.0],
  [32, 7.5],
  [30, 7.0],
  [26, 6.5],
  [23, 6.0],
  [18, 5.5],
  [16, 5.0],
  [13, 4.5],
  [11, 4.0],
  [8, 3.5],
  [6, 3.0],
  [4, 2.5],
  [3, 2.0],
  [2, 1.5],
  [1, 1.0],
  [0, 0.0],
];

export function listeningBandFromRaw40(_track: Track, raw: number): number {
  const clamped = Math.max(0, Math.min(40, Math.round(raw)));
  for (const [threshold, band] of LISTENING_TABLE) {
    if (clamped >= threshold) return band;
  }
  return 0;
}

// Scale a partial-section raw score (e.g. 17 points out of 22 possible)
// to its 40-question equivalent so the conversion table applies.
// total ≤ 0 returns 0 to avoid divide-by-zero.
export function scaleListeningRawTo40(
  correct: number,
  total: number,
): number {
  if (total <= 0) return 0;
  const scaled = (correct / total) * 40;
  return Math.max(0, Math.min(40, Math.round(scaled)));
}

export function listeningBandFromPartial(
  track: Track,
  correct: number,
  total: number,
): number {
  return listeningBandFromRaw40(track, scaleListeningRawTo40(correct, total));
}
