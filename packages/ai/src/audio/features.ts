// Transcript-derived audio features for Speaking grading.
//
// These are computed from Whisper's `verbose_json` segments + duration —
// purely transcript-level, no DSP. The features cover Fluency & Coherence
// (speaking rate, pauses, speaking ratio) and feed indirectly into
// Pronunciation (intelligibility shows up as Whisper confidence; we report
// speaking-rate + pause distribution as the grading-relevant signal).
//
// True pitch-range + articulation-rate features require audio-signal
// analysis (DSP on the raw PCM) and are deferred to a follow-up — see ADR
// 0005 (audio features scaffold). The `ai-grading` skill explicitly says
// pronunciation is scored on intelligibility, not nativeness, so the
// transcript-derived features above are defensible for v1.

const PAUSE_THRESHOLD_MS = 500;
const MS_PER_SEC = 1000;
const SEC_PER_MIN = 60;

export type TranscriptSegment = {
  // Seconds from the start of the recording.
  start: number;
  end: number;
  text: string;
};

export type AudioFeatures = {
  // The duration the transcript covers (Whisper-reported audio length).
  duration_sec: number;
  // Total word count across all segments — the candidate's words.
  total_words: number;
  // Words per minute, rounded to 1 decimal.
  wpm: number;
  // Number of inter-segment gaps that exceeded PAUSE_THRESHOLD_MS.
  pause_count: number;
  // Mean and longest pause length over the counted pauses (0 when none).
  mean_pause_ms: number;
  longest_pause_ms: number;
  // Fraction of duration_sec during which the candidate was speaking
  // (per Whisper segments). Range 0..1, 2-decimal precision.
  speaking_ratio: number;
};

function countWords(s: string): number {
  if (!s) return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function extractAudioFeatures(args: {
  segments: TranscriptSegment[];
  duration_sec: number;
}): AudioFeatures {
  const { segments, duration_sec } = args;

  const totalWords = segments.reduce((acc, s) => acc + countWords(s.text), 0);

  const speakingSec = segments.reduce(
    (acc, s) => acc + Math.max(0, s.end - s.start),
    0,
  );

  const wpm =
    duration_sec > 0 ? (totalWords / duration_sec) * SEC_PER_MIN : 0;

  // Pauses = gaps between consecutive segments that exceed the threshold.
  // Segments are assumed to be in start-order; we sort defensively so a
  // mis-ordered Whisper response doesn't produce negative gaps.
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const pauses: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    const gapMs = (curr.start - prev.end) * MS_PER_SEC;
    if (gapMs >= PAUSE_THRESHOLD_MS) pauses.push(gapMs);
  }

  const meanPause =
    pauses.length > 0
      ? Math.round(pauses.reduce((a, b) => a + b, 0) / pauses.length)
      : 0;
  const longestPause =
    pauses.length > 0 ? Math.round(Math.max(...pauses)) : 0;

  return {
    duration_sec,
    total_words: totalWords,
    wpm: Number(wpm.toFixed(1)),
    pause_count: pauses.length,
    mean_pause_ms: meanPause,
    longest_pause_ms: longestPause,
    speaking_ratio:
      duration_sec > 0
        ? Number((speakingSec / duration_sec).toFixed(2))
        : 0,
  };
}
