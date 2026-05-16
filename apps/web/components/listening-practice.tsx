"use client";

// Listening section practice runner.
//
// Two playback modes:
//   - "practice" (default): transcript visible alongside questions,
//     per-segment <audio controls> with pause + rewind, free part
//     navigation. The everyday drill experience.
//   - "strict": no transcript text rendered, single-play per segment
//     (pause hidden via a custom widget, seek blocked, replay blocked),
//     no part navigation backwards. Used by the Phase 6 mock
//     orchestrator. Scrub attempts are logged via a server action.
//
// Phase 1 question kinds wired (mcq-single, mcq-multi,
// sentence-completion, short-answer, completion-blank). Strict mode
// uses the same input widgets — the difference is the player envelope
// and the transcript visibility.
//
// All five Phase 1 question kinds are wired:
//   - listening-mcq-single
//   - listening-mcq-multi
//   - listening-sentence-completion
//   - listening-short-answer
//   - listening-completion-blank
//
// State model: one Map<questionId, response> for the whole section.
// Autosave debounces by 600 ms and POSTs the response shape the server
// action expects. The server is authoritative on shape — invalid payloads
// come back with `error: "invalid"` and the UI surfaces it inline.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  autosaveListeningAnswer,
  issueSignedAudioUrl,
  submitListeningAttempt,
  type ClientListeningResponse,
} from "@/lib/listening/actions";

// ─── Wire-format types (must round-trip through JSON) ───────────────────

export type ListeningRunnerSpeaker = {
  id: string;
  name: string;
  role: "narrator" | "examiner" | "speaker";
  accent: string;
};

export type ListeningRunnerSegment =
  | { kind: "narration"; text: string; audio_sha256: string | null }
  | {
      kind: "speech";
      speaker_id: string;
      text: string;
      audio_sha256: string | null;
    }
  | { kind: "reading-pause"; seconds: number; instruction: string | null }
  | {
      kind: "questions-preview";
      seconds: number;
      question_positions: number[];
    };

export type ListeningRunnerCell =
  | { kind: "text"; text: string }
  | { kind: "blank"; slot_id: string };

export type ListeningRunnerRow = {
  label: string | null;
  is_header: boolean;
  cells: ListeningRunnerCell[][];
};

export type ListeningRunnerBlock = {
  id: string;
  layout: "form" | "notes" | "table" | "flow-chart" | "summary" | "diagram";
  title: string | null;
  instructions: string | null;
  rows: ListeningRunnerRow[];
};

export type ListeningRunnerPart = {
  part: 1 | 2 | 3 | 4;
  context: "social" | "academic";
  title: string;
  speakers: ListeningRunnerSpeaker[];
  question_positions: number[];
  transcript: ListeningRunnerSegment[];
  completion_blocks: ListeningRunnerBlock[];
};

export type ListeningRunnerQuestionPayload =
  | {
      kind: "listening-mcq-single";
      options: { id: string; text: string }[];
    }
  | {
      kind: "listening-mcq-multi";
      options: { id: string; text: string }[];
      pick_count: number;
    }
  | {
      kind: "listening-sentence-completion";
      stem: string;
      word_limit: number;
    }
  | { kind: "listening-short-answer"; word_limit: number }
  | {
      kind: "listening-completion-blank";
      block_id: string;
      slot_id: string;
      word_limit: number;
    };

export type ListeningRunnerQuestion = {
  id: string;
  position: number;
  prompt: string;
  points: number;
  payload: ListeningRunnerQuestionPayload;
};

// ─── Component ──────────────────────────────────────────────────────────

export type ListeningPlayerMode = "practice" | "strict";

type Props = {
  attemptId: string;
  startedAtIso: string;
  parts: ListeningRunnerPart[];
  questions: ListeningRunnerQuestion[];
  initialResponses: Record<string, unknown>;
  // Defaults to "practice". The mock orchestrator (Phase 6) renders this
  // component with mode="strict".
  mode?: ListeningPlayerMode;
};

type Status =
  | { kind: "idle" }
  | { kind: "saving"; questionId: string }
  | { kind: "saved"; at: string }
  | { kind: "error"; message: string };

export function ListeningPractice({
  attemptId,
  startedAtIso,
  parts,
  questions,
  initialResponses,
  mode = "practice",
}: Props) {
  const [partIndex, setPartIndex] = useState(0);
  const [responses, setResponses] = useState<
    Record<string, ClientListeningResponse>
  >(() => seedResponses(questions, initialResponses));
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Tracks which part numbers have started playing in this session, so
  // the Begin button disables after first use even when the learner
  // navigates away and back (real IELTS audio plays exactly once).
  const [playedParts, setPlayedParts] = useState<Set<number>>(
    () => new Set(),
  );
  const startedAt = useMemo(() => new Date(startedAtIso), [startedAtIso]);
  const elapsed = useElapsedSeconds(startedAt);

  const markPartPlayed = useCallback((part: number) => {
    setPlayedParts((prev) => {
      if (prev.has(part)) return prev;
      const next = new Set(prev);
      next.add(part);
      return next;
    });
  }, []);

  // Group questions by part position membership for fast lookup.
  const questionsByPart = useMemo(() => {
    const map = new Map<number, ListeningRunnerQuestion[]>();
    for (const part of parts) map.set(part.part, []);
    for (const q of questions) {
      const part = parts.find((p) => p.question_positions.includes(q.position));
      if (!part) continue;
      const list = map.get(part.part) ?? [];
      list.push(q);
      map.set(part.part, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [parts, questions]);

  // Stable autosave: keyed by question id, debounced. Outstanding timers
  // are cleared on unmount so React-strict-mode dev re-mounts don't leak.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    // Capture the ref's current Map into a local so the cleanup function
    // closes over the SAME Map that effect-setup observed — defensive
    // against ref churn (per react-hooks/exhaustive-deps).
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const onChange = useCallback(
    (questionId: string, next: ClientListeningResponse) => {
      setResponses((prev) => ({ ...prev, [questionId]: next }));
      const existing = timers.current.get(questionId);
      if (existing) clearTimeout(existing);
      const handle = setTimeout(async () => {
        setStatus({ kind: "saving", questionId });
        try {
          const result = await autosaveListeningAnswer(
            attemptId,
            questionId,
            next,
          );
          if (result.ok) {
            setStatus({ kind: "saved", at: result.savedAt });
          } else {
            setStatus({
              kind: "error",
              message:
                result.error === "already_submitted"
                  ? "This attempt is already submitted."
                  : "We couldn't save that answer. Try again.",
            });
          }
        } catch {
          setStatus({
            kind: "error",
            message: "Network hiccup — your answer didn't save.",
          });
        }
      }, 600);
      timers.current.set(questionId, handle);
    },
    [attemptId],
  );

  const currentPart = parts[partIndex];
  if (!currentPart) {
    return (
      <section className="px-6 py-16">
        <p className="font-body text-base text-brand-grey-900">
          This Listening section has no parts to render.
        </p>
      </section>
    );
  }
  const currentQuestions = questionsByPart.get(currentPart.part) ?? [];

  return (
    <section className="px-4 md:px-6 py-8 md:py-12">
      <div className="mx-auto max-w-5xl">
        <RunnerHeader
          elapsed={elapsed}
          status={status}
          totalQuestions={questions.length}
          answeredCount={countAnswered(responses)}
          mode={mode}
        />

        <PartTabs
          parts={parts}
          current={partIndex}
          onChange={setPartIndex}
          playedParts={playedParts}
        />

        <PartPanel
          attemptId={attemptId}
          part={currentPart}
          questions={currentQuestions}
          responses={responses}
          onChange={onChange}
          mode={mode}
          alreadyPlayed={playedParts.has(currentPart.part)}
          onPlayStarted={markPartPlayed}
        />

        <PartNavigation
          partIndex={partIndex}
          partCount={parts.length}
          onPrev={() => setPartIndex((i) => Math.max(0, i - 1))}
          onNext={() => setPartIndex((i) => Math.min(parts.length - 1, i + 1))}
        />

        <SubmitBar attemptId={attemptId} />
      </div>
    </section>
  );
}

// ─── Header / status ────────────────────────────────────────────────────

function RunnerHeader({
  elapsed,
  status,
  totalQuestions,
  answeredCount,
  mode,
}: {
  elapsed: number;
  status: Status;
  totalQuestions: number;
  answeredCount: number;
  mode: ListeningPlayerMode;
}) {
  const strict = mode === "strict";
  return (
    <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <p className="font-body text-sm uppercase tracking-widest text-brand-red">
          Listening · {strict ? "exam mode" : "practice mode"}
        </p>
        <h1 className="mt-1 font-display italic font-bold text-3xl md:text-4xl text-brand-black leading-tight">
          {strict ? "Single play. Eyes on the questions." : "Take your time."}
        </h1>
        <p className="mt-2 font-body text-sm text-brand-grey-700">
          Answered{" "}
          <span className="font-heading font-bold text-brand-black">
            {answeredCount}
          </span>{" "}
          / {totalQuestions} · time elapsed {formatElapsed(elapsed)}
        </p>
      </div>
      <StatusPill status={status} />
    </header>
  );
}

function StatusPill({ status }: { status: Status }) {
  if (status.kind === "idle") return null;
  const palette =
    status.kind === "error"
      ? "bg-brand-red-soft text-brand-red"
      : status.kind === "saving"
        ? "bg-brand-grey-100 text-brand-grey-700"
        : "bg-brand-grey-100 text-brand-grey-700";
  const text =
    status.kind === "saving"
      ? "Saving…"
      : status.kind === "saved"
        ? "Saved"
        : status.message;
  return (
    <span
      className={`inline-flex items-center rounded-pill px-3 py-1 font-heading font-bold text-xs ${palette}`}
    >
      {text}
    </span>
  );
}

// ─── Part tabs + navigation ─────────────────────────────────────────────

function PartTabs({
  parts,
  current,
  onChange,
  playedParts,
}: {
  parts: ListeningRunnerPart[];
  current: number;
  onChange: (i: number) => void;
  playedParts: Set<number>;
}) {
  return (
    <nav aria-label="Listening part" className="mb-6 flex flex-wrap gap-2">
      {parts.map((p, i) => {
        const active = i === current;
        const played = playedParts.has(p.part);
        return (
          <button
            key={p.part}
            type="button"
            onClick={() => onChange(i)}
            aria-current={active ? "page" : undefined}
            className={
              "inline-flex items-center gap-2 rounded-pill px-4 py-2 font-heading font-bold text-sm ring-1 transition-colors " +
              (active
                ? "bg-brand-red text-white ring-brand-red"
                : "bg-brand-white text-brand-grey-700 ring-brand-grey-200 hover:text-brand-black")
            }
            title={played ? "Audio already played for this part." : undefined}
          >
            <span>Part {p.part}</span>
            <span className="font-body font-normal text-xs opacity-80">
              {p.title}
            </span>
            {played ? (
              <span
                aria-label="played"
                className="font-body font-normal text-xs opacity-70"
              >
                ✓
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

function PartNavigation({
  partIndex,
  partCount,
  onPrev,
  onNext,
}: {
  partIndex: number;
  partCount: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-8 flex items-center justify-between">
      <button
        type="button"
        onClick={onPrev}
        disabled={partIndex === 0}
        className="inline-flex items-center rounded-pill bg-brand-white px-4 py-2 font-heading font-bold text-sm text-brand-grey-700 ring-1 ring-brand-grey-200 hover:text-brand-black disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ← Previous part
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={partIndex === partCount - 1}
        className="inline-flex items-center rounded-pill bg-brand-white px-4 py-2 font-heading font-bold text-sm text-brand-grey-700 ring-1 ring-brand-grey-200 hover:text-brand-black disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Next part →
      </button>
    </div>
  );
}

// ─── Per-part panel ─────────────────────────────────────────────────────

function PartPanel({
  attemptId,
  part,
  questions,
  responses,
  onChange,
  mode,
  alreadyPlayed,
  onPlayStarted,
}: {
  attemptId: string;
  part: ListeningRunnerPart;
  questions: ListeningRunnerQuestion[];
  responses: Record<string, ClientListeningResponse>;
  onChange: (questionId: string, next: ClientListeningResponse) => void;
  mode: ListeningPlayerMode;
  alreadyPlayed: boolean;
  onPlayStarted: (part: number) => void;
}) {
  const speakerLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of part.speakers) m.set(s.id, s.name);
    return m;
  }, [part]);

  const blockById = useMemo(() => {
    const m = new Map<string, ListeningRunnerBlock>();
    for (const b of part.completion_blocks) m.set(b.id, b);
    return m;
  }, [part]);

  const strict = mode === "strict";
  // In strict mode the questions panel goes full-width — transcript is
  // hidden because the audio plays once and that's the whole point.
  const containerClass = strict
    ? "space-y-5"
    : "grid grid-cols-1 lg:grid-cols-2 gap-8";

  return (
    <div className={containerClass}>
      {!strict ? (
        <article
          aria-label={`Part ${part.part} transcript`}
          className="space-y-4"
        >
          <header>
            <p className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
              Part {part.part} · {part.context}
            </p>
            <h2 className="mt-1 font-heading font-bold text-xl text-brand-black">
              {part.title}
            </h2>
            <p className="mt-1 font-body text-xs text-brand-grey-500">
              Speakers:{" "}
              {part.speakers.map((s) => `${s.name} (${s.accent})`).join(", ")}
            </p>
          </header>

          <div className="space-y-3">
            {part.transcript.map((seg, i) => (
              <TranscriptSegment
                key={i}
                attemptId={attemptId}
                segment={seg}
                speakerLabelById={speakerLabelById}
              />
            ))}
          </div>
        </article>
      ) : (
        <StrictAudioPanel
          attemptId={attemptId}
          part={part}
          alreadyPlayed={alreadyPlayed}
          onPlayStarted={onPlayStarted}
        />
      )}

      <article aria-label={`Part ${part.part} questions`} className="space-y-5">
        <header>
          <p className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
            {strict ? "Answer as you listen" : "Questions"}
          </p>
          <h2 className="mt-1 font-heading font-bold text-xl text-brand-black">
            Answer {questions.length}.{" "}
            <span className="font-body font-normal text-brand-grey-700">
              {strict
                ? "The recording will play once."
                : "Each saves as you type."}
            </span>
          </h2>
        </header>

        <ol className="space-y-5">
          {questions.map((q) => (
            <li
              key={q.id}
              className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-5 space-y-3"
            >
              <header className="flex items-start gap-3">
                <span className="inline-flex items-center justify-center min-w-[2.25rem] h-9 rounded-pill bg-brand-black font-heading font-bold text-sm text-white px-2">
                  {q.position + 1}
                </span>
                <div>
                  <p className="font-body text-sm font-bold text-brand-black leading-snug">
                    {q.prompt}
                  </p>
                  <p className="font-body text-xs text-brand-grey-500">
                    {q.payload.kind.replace("listening-", "")} · {q.points} pt
                  </p>
                </div>
              </header>

              <QuestionInput
                question={q}
                value={responses[q.id]}
                onChange={onChange}
                blockById={blockById}
              />
            </li>
          ))}
        </ol>
      </article>
    </div>
  );
}

// Strict-mode audio panel: a single "Begin Part N audio" button that
// chains every speech / narration segment with its declared reading-
// pause silences, plays once, and cannot be paused / scrubbed / restarted.
// Reading-ahead and post-part check pauses come through as honest silent
// gaps so the timing matches the real exam.
function StrictAudioPanel({
  attemptId,
  part,
  alreadyPlayed,
  onPlayStarted,
}: {
  attemptId: string;
  part: ListeningRunnerPart;
  alreadyPlayed: boolean;
  onPlayStarted: (part: number) => void;
}) {
  // If the parent says this part already played (because the learner
  // started it on a previous tab visit), start in "finished" so the UI
  // never offers a replay. Audio plays at most once per session.
  const [playState, setPlayState] = useState<
    "idle" | "loading" | "playing" | "finished" | "error"
  >(alreadyPlayed ? "finished" : "idle");
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Index of playable segments only (speech + narration with audio_clip).
  // reading-pause / questions-preview slots are handled as setTimeout gaps.
  type PlaylistItem =
    | { type: "audio"; sha256: string }
    | { type: "pause"; seconds: number };
  const playlist = useMemo(() => {
    const out: PlaylistItem[] = [];
    for (const seg of part.transcript) {
      if (seg.kind === "speech" || seg.kind === "narration") {
        if (seg.audio_sha256)
          out.push({ type: "audio", sha256: seg.audio_sha256 });
      } else if (seg.kind === "reading-pause") {
        out.push({ type: "pause", seconds: seg.seconds });
      } else if (seg.kind === "questions-preview") {
        out.push({ type: "pause", seconds: seg.seconds });
      }
    }
    return out;
  }, [part]);

  // State-machine advance: when the current item is a pause, schedule a
  // timer that bumps segmentIndex when it expires. When it's audio, we
  // wait for the <audio> element's onEnded to call advance(). Using an
  // effect (rather than a recursive callback) avoids the
  // use-before-define lint trip from a setTimeout closure self-referencing
  // its callback.
  const advance = useCallback(() => {
    setSegmentIndex((i) => {
      if (i + 1 >= playlist.length) {
        setPlayState("finished");
        return i;
      }
      return i + 1;
    });
  }, [playlist.length]);

  useEffect(() => {
    if (playState !== "playing") return;
    const item = playlist[segmentIndex];
    if (!item || item.type !== "pause") return;
    const handle = setTimeout(() => {
      advance();
    }, item.seconds * 1000);
    pauseTimerRef.current = handle;
    return () => {
      clearTimeout(handle);
      if (pauseTimerRef.current === handle) pauseTimerRef.current = null;
    };
  }, [advance, playState, playlist, segmentIndex]);

  useEffect(() => {
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    };
  }, []);

  const start = useCallback(() => {
    setPlayState((prev) => {
      if (prev !== "idle") return prev;
      // Notify the parent so a tab-switch + return doesn't reset our
      // "played" status — the per-tab unmount/remount lifecycle would
      // otherwise wipe it.
      onPlayStarted(part.part);
      return "playing";
    });
    setError(null);
    setSegmentIndex(0);
  }, [onPlayStarted, part.part]);

  const currentItem = playState === "playing" ? playlist[segmentIndex] : null;

  return (
    <article className="rounded-lg bg-brand-black text-white p-6 space-y-4">
      <header>
        <p className="font-body text-xs uppercase tracking-widest text-brand-red">
          Part {part.part} · {part.context}
        </p>
        <h2 className="mt-1 font-heading font-bold text-xl text-white">
          {part.title}
        </h2>
        <p className="mt-1 font-body text-xs text-white/70">
          Speakers:{" "}
          {part.speakers.map((s) => `${s.name} (${s.accent})`).join(", ")}
        </p>
      </header>

      {playState === "idle" ? (
        <button
          type="button"
          onClick={start}
          className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-5 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black"
        >
          ▶ Begin Part {part.part} audio
        </button>
      ) : null}

      {playState === "playing" ? (
        <div className="space-y-2">
          <p className="font-body text-sm text-white/80">
            Playing segment {segmentIndex + 1} of {playlist.length}…
          </p>
          {currentItem && currentItem.type === "audio" ? (
            <StrictAudioSegment
              attemptId={attemptId}
              sha256={currentItem.sha256}
              audioRef={audioRef}
              onEnded={() => advance()}
              onError={() => setError("Audio failed to load.")}
            />
          ) : currentItem && currentItem.type === "pause" ? (
            <p className="font-body text-xs italic text-white/60">
              [silent pause — {currentItem.seconds}s]
            </p>
          ) : null}
        </div>
      ) : null}

      {playState === "finished" ? (
        <p className="font-body text-sm text-white/80">
          {alreadyPlayed
            ? `Part ${part.part} audio has already played. It cannot be replayed — the exam plays each part once.`
            : `Part ${part.part} audio finished. Move on to the next part below.`}
        </p>
      ) : null}

      {error ? (
        <p className="font-body text-sm text-brand-red">{error}</p>
      ) : null}

      <p className="font-body text-xs text-white/60">
        Exam mode: audio plays once. No pause, no rewind.
      </p>
    </article>
  );
}

function StrictAudioSegment({
  attemptId,
  sha256,
  audioRef,
  onEnded,
  onError,
}: {
  attemptId: string;
  sha256: string;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  onEnded: () => void;
  onError: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await issueSignedAudioUrl(attemptId, sha256);
        if (cancelled) return;
        if (res.ok) setUrl(res.url);
        else onError();
      } catch {
        if (!cancelled) onError();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attemptId, sha256, onError]);

  // Note: native <audio> elements always expose seek + pause via the
  // OS-level media key UI. We render WITHOUT controls and auto-play; the
  // visible widget is just a progress strip. A determined cheater can
  // still scrub via devtools — same threat model as commercial IELTS
  // practice software. Documented in ADR 0007 / Phase 5.
  if (!url) {
    return (
      <p className="font-body text-xs italic text-white/60">Loading audio…</p>
    );
  }
  return (
    <audio
      ref={audioRef}
      src={url}
      autoPlay
      onEnded={onEnded}
      onError={onError}
      // No `controls` attribute. The strict mode envelope hides the
      // affordance; the audio element still exists in the DOM and
      // determined users will find ways around it.
    />
  );
}

// ─── Transcript segment ─────────────────────────────────────────────────

function TranscriptSegment({
  attemptId,
  segment,
  speakerLabelById,
}: {
  attemptId: string;
  segment: ListeningRunnerSegment;
  speakerLabelById: Map<string, string>;
}) {
  if (segment.kind === "reading-pause") {
    return (
      <p className="font-body text-xs italic text-brand-grey-500 border-l-2 border-brand-grey-300 pl-3">
        [pause {segment.seconds}s
        {segment.instruction ? ` — ${segment.instruction}` : ""}]
      </p>
    );
  }
  if (segment.kind === "questions-preview") {
    return (
      <p className="font-body text-xs italic text-brand-grey-500 border-l-2 border-brand-grey-300 pl-3">
        [look at questions {segment.question_positions.map((p) => p + 1).join(", ")} — {segment.seconds}s]
      </p>
    );
  }
  const speakerLabel =
    segment.kind === "speech"
      ? (speakerLabelById.get(segment.speaker_id) ?? segment.speaker_id)
      : "Narrator";
  return (
    <div className="space-y-1">
      <p className="font-body text-sm text-brand-grey-900 leading-relaxed">
        <span className="font-heading font-bold text-brand-red mr-2">
          {speakerLabel}:
        </span>
        {segment.text}
      </p>
      {segment.audio_sha256 ? (
        <LazyAudioPlayer
          attemptId={attemptId}
          sha256={segment.audio_sha256}
        />
      ) : null}
    </div>
  );
}

function LazyAudioPlayer({
  attemptId,
  sha256,
}: {
  attemptId: string;
  sha256: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (url || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await issueSignedAudioUrl(attemptId, sha256);
      if (res.ok) {
        setUrl(res.url);
      } else {
        setError(
          res.error === "unknown_clip"
            ? "Audio for this segment isn't available."
            : "Couldn't load audio.",
        );
      }
    } catch {
      setError("Couldn't load audio.");
    } finally {
      setLoading(false);
    }
  }, [attemptId, sha256, url, loading]);

  if (error) {
    return <p className="font-body text-xs text-brand-grey-500">{error}</p>;
  }
  if (!url) {
    return (
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-pill bg-brand-grey-100 px-3 py-1 font-heading font-bold text-xs text-brand-grey-900 hover:bg-brand-grey-200 disabled:opacity-50"
      >
        {loading ? "Loading…" : "▶ Play audio"}
      </button>
    );
  }
  return (
    // Default <audio controls> is fine for practice mode — pause + seek
    // allowed. Phase 5 strict mode will swap this for a locked-down
    // custom player.
    <audio controls preload="none" src={url} className="w-full" />
  );
}

// ─── Question inputs ────────────────────────────────────────────────────

function QuestionInput({
  question,
  value,
  onChange,
  blockById,
}: {
  question: ListeningRunnerQuestion;
  value: ClientListeningResponse | undefined;
  onChange: (questionId: string, next: ClientListeningResponse) => void;
  blockById: Map<string, ListeningRunnerBlock>;
}) {
  const payload = question.payload;
  switch (payload.kind) {
    case "listening-mcq-single":
      return (
        <McqSingleInput
          questionId={question.id}
          options={payload.options}
          value={
            value && value.kind === "listening-mcq-single" ? value.selected : null
          }
          onChange={(selected) =>
            onChange(question.id, { kind: "listening-mcq-single", selected })
          }
        />
      );
    case "listening-mcq-multi":
      return (
        <McqMultiInput
          questionId={question.id}
          options={payload.options}
          pickCount={payload.pick_count}
          value={
            value && value.kind === "listening-mcq-multi" ? value.selected : []
          }
          onChange={(selected) =>
            onChange(question.id, { kind: "listening-mcq-multi", selected })
          }
        />
      );
    case "listening-sentence-completion":
      return (
        <SentenceCompletionInput
          questionId={question.id}
          stem={payload.stem}
          wordLimit={payload.word_limit}
          value={
            value && value.kind === "listening-sentence-completion"
              ? value.text
              : ""
          }
          onChange={(text) =>
            onChange(question.id, {
              kind: "listening-sentence-completion",
              text,
            })
          }
        />
      );
    case "listening-short-answer":
      return (
        <ShortAnswerInput
          questionId={question.id}
          wordLimit={payload.word_limit}
          value={
            value && value.kind === "listening-short-answer" ? value.text : ""
          }
          onChange={(text) =>
            onChange(question.id, { kind: "listening-short-answer", text })
          }
        />
      );
    case "listening-completion-blank":
      return (
        <CompletionBlankInput
          questionId={question.id}
          block={blockById.get(payload.block_id) ?? null}
          slotId={payload.slot_id}
          wordLimit={payload.word_limit}
          value={
            value && value.kind === "listening-completion-blank"
              ? value.text
              : ""
          }
          onChange={(text) =>
            onChange(question.id, {
              kind: "listening-completion-blank",
              text,
            })
          }
        />
      );
  }
}

function McqSingleInput({
  questionId,
  options,
  value,
  onChange,
}: {
  questionId: string;
  options: { id: string; text: string }[];
  value: string | null;
  onChange: (selected: string | null) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Choose one</legend>
      {options.map((o) => {
        const id = `${questionId}-${o.id}`;
        return (
          <label
            key={o.id}
            htmlFor={id}
            className="flex items-start gap-3 cursor-pointer rounded-md px-3 py-2 hover:bg-brand-grey-50"
          >
            <input
              id={id}
              type="radio"
              name={questionId}
              value={o.id}
              checked={value === o.id}
              onChange={() => onChange(o.id)}
              className="mt-1 accent-brand-red"
            />
            <span className="font-body text-sm text-brand-grey-900">
              <span className="font-heading font-bold text-brand-grey-700 mr-2">
                {o.id}.
              </span>
              {o.text}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function McqMultiInput({
  questionId,
  options,
  pickCount,
  value,
  onChange,
}: {
  questionId: string;
  options: { id: string; text: string }[];
  pickCount: number;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const selected = new Set(value);
  const handleToggle = (id: string) => {
    if (selected.has(id)) {
      const next = value.filter((x) => x !== id);
      onChange(next);
    } else {
      // Cap at pickCount — adding past the limit drops the oldest.
      const next = [...value, id];
      while (next.length > pickCount) next.shift();
      onChange(next);
    }
  };
  return (
    <fieldset className="space-y-2">
      <legend className="font-body text-xs text-brand-grey-500 mb-1">
        Choose {pickCount}.
      </legend>
      {options.map((o) => {
        const id = `${questionId}-${o.id}`;
        const isChecked = selected.has(o.id);
        return (
          <label
            key={o.id}
            htmlFor={id}
            className="flex items-start gap-3 cursor-pointer rounded-md px-3 py-2 hover:bg-brand-grey-50"
          >
            <input
              id={id}
              type="checkbox"
              name={questionId}
              value={o.id}
              checked={isChecked}
              onChange={() => handleToggle(o.id)}
              className="mt-1 accent-brand-red"
            />
            <span className="font-body text-sm text-brand-grey-900">
              <span className="font-heading font-bold text-brand-grey-700 mr-2">
                {o.id}.
              </span>
              {o.text}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function SentenceCompletionInput({
  questionId,
  stem,
  wordLimit,
  value,
  onChange,
}: {
  questionId: string;
  stem: string;
  wordLimit: number;
  value: string;
  onChange: (text: string) => void;
}) {
  const [before, after] = stem.split("___", 2);
  return (
    <div className="space-y-2">
      <p className="font-body text-sm text-brand-grey-900">
        {before}
        <input
          id={questionId}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Sentence-completion answer"
          className="mx-2 inline-block min-w-[8rem] rounded-md ring-1 ring-brand-grey-300 bg-white px-2 py-1 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
        />
        {after ?? ""}
      </p>
      <p className="font-body text-xs text-brand-grey-500">
        Up to {wordLimit} word{wordLimit === 1 ? "" : "s"}.
      </p>
    </div>
  );
}

function ShortAnswerInput({
  questionId,
  wordLimit,
  value,
  onChange,
}: {
  questionId: string;
  wordLimit: number;
  value: string;
  onChange: (text: string) => void;
}) {
  return (
    <div className="space-y-2">
      <input
        id={questionId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Short-answer response"
        className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
      />
      <p className="font-body text-xs text-brand-grey-500">
        Up to {wordLimit} word{wordLimit === 1 ? "" : "s"}.
      </p>
    </div>
  );
}

function CompletionBlankInput({
  questionId,
  block,
  slotId,
  wordLimit,
  value,
  onChange,
}: {
  questionId: string;
  block: ListeningRunnerBlock | null;
  slotId: string;
  wordLimit: number;
  value: string;
  onChange: (text: string) => void;
}) {
  return (
    <div className="space-y-2">
      {block ? (
        <p className="font-body text-xs text-brand-grey-500">
          {block.title ?? `Block ${block.id}`} · slot{" "}
          <code className="font-heading font-bold">{slotId}</code>
        </p>
      ) : null}
      <input
        id={questionId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Completion-blank ${slotId}`}
        className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
      />
      <p className="font-body text-xs text-brand-grey-500">
        Up to {wordLimit} word{wordLimit === 1 ? "" : "s"}.
      </p>
    </div>
  );
}

// ─── Submit bar ─────────────────────────────────────────────────────────

function SubmitBar({ attemptId }: { attemptId: string }) {
  return (
    <form
      action={submitListeningAttempt}
      className="mt-10 rounded-lg bg-brand-black text-white p-6 flex flex-wrap items-center justify-between gap-4"
    >
      <input type="hidden" name="attemptId" value={attemptId} />
      <div>
        <p className="font-heading font-bold text-lg">
          Done? Submit for grading.
        </p>
        <p className="font-body text-sm text-white/70">
          Listening is auto-graded — you&apos;ll see your raw score, band, and
          per-question feedback on the next screen.
        </p>
      </div>
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black"
    >
      {pending ? "Submitting…" : "Submit Listening"}
    </button>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function seedResponses(
  questions: ListeningRunnerQuestion[],
  initial: Record<string, unknown>,
): Record<string, ClientListeningResponse> {
  const out: Record<string, ClientListeningResponse> = {};
  for (const q of questions) {
    const raw = initial[q.id];
    if (!raw || typeof raw !== "object") {
      out[q.id] = defaultResponseFor(q);
      continue;
    }
    const r = raw as Record<string, unknown>;
    switch (q.payload.kind) {
      case "listening-mcq-single":
        out[q.id] = {
          kind: q.payload.kind,
          selected:
            typeof r.selected === "string"
              ? r.selected
              : r.selected === null
                ? null
                : null,
        };
        break;
      case "listening-mcq-multi":
        out[q.id] = {
          kind: q.payload.kind,
          selected: Array.isArray(r.selected)
            ? (r.selected as unknown[]).filter(
                (x): x is string => typeof x === "string",
              )
            : [],
        };
        break;
      default:
        out[q.id] = {
          kind: q.payload.kind,
          text: typeof r.text === "string" ? r.text : "",
        } as ClientListeningResponse;
    }
  }
  return out;
}

function defaultResponseFor(
  q: ListeningRunnerQuestion,
): ClientListeningResponse {
  switch (q.payload.kind) {
    case "listening-mcq-single":
      return { kind: q.payload.kind, selected: null };
    case "listening-mcq-multi":
      return { kind: q.payload.kind, selected: [] };
    default:
      return { kind: q.payload.kind, text: "" } as ClientListeningResponse;
  }
}

function countAnswered(
  responses: Record<string, ClientListeningResponse>,
): number {
  let n = 0;
  for (const r of Object.values(responses)) {
    if (r.kind === "listening-mcq-single" && r.selected !== null) n++;
    else if (r.kind === "listening-mcq-multi" && r.selected.length > 0) n++;
    else if ("text" in r && r.text.trim().length > 0) n++;
  }
  return n;
}

function useElapsedSeconds(startedAt: Date): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.floor((now - startedAt.getTime()) / 1000));
}

function formatElapsed(sec: number): string {
  const mm = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const ss = (sec % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
