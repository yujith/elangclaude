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
  // Which part the GLOBAL audio panel is currently playing through.
  // null when the section is idle or finished. The visible tab
  // auto-tracks this (overridable by clicking tabs to view questions
  // for another part).
  const [currentlyPlayingPart, setCurrentlyPlayingPart] = useState<
    number | null
  >(null);
  const startedAt = useMemo(() => new Date(startedAtIso), [startedAtIso]);
  // NOTE: we deliberately do NOT call useElapsedSeconds here — the
  // per-second tick used to re-render the entire ListeningPractice
  // tree, which churned every callback prop passed to children and
  // caused the audio's URL-fetch effect to refire every second
  // (reloading the <audio src> in a tight loop). The elapsed timer
  // now lives inside ElapsedTimer, scoped to the header.

  // Auto-follow the audio. When the global audio enters a new part,
  // we move the visible tab to match — the learner doesn't have to
  // chase the audio with the tabs. They can still override by
  // clicking a different tab to read ahead.
  const handlePartChange = useCallback(
    (partNumber: number) => {
      setCurrentlyPlayingPart(partNumber);
      const idx = parts.findIndex((p) => p.part === partNumber);
      if (idx >= 0) setPartIndex(idx);
    },
    [parts],
  );

  // Tracks the wall-clock instant the global audio finished. The
  // SubmitBar reads this to start a 10-minute auto-submit countdown:
  // real IELTS gives 10 minutes at the end to transfer answers; we
  // give 10 minutes for the learner to review + click Submit, after
  // which we auto-submit so they don't sit forever on a half-done test.
  const [audioFinishedAt, setAudioFinishedAt] = useState<number | null>(null);

  const handleFinished = useCallback(() => {
    setCurrentlyPlayingPart(null);
    setAudioFinishedAt((prev) => prev ?? Date.now());
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
          startedAt={startedAt}
          status={status}
          totalQuestions={questions.length}
          answeredCount={countAnswered(responses)}
          mode={mode}
        />

        <GlobalAudioPanel
          attemptId={attemptId}
          parts={parts}
          onPartChange={handlePartChange}
          onFinished={handleFinished}
        />

        <PartTabs
          parts={parts}
          current={partIndex}
          onChange={setPartIndex}
          currentlyPlayingPart={currentlyPlayingPart}
        />

        <QuestionsList
          part={currentPart}
          questions={currentQuestions}
          responses={responses}
          onChange={onChange}
        />

        <PartNavigation
          partIndex={partIndex}
          partCount={parts.length}
          onPrev={() => setPartIndex((i) => Math.max(0, i - 1))}
          onNext={() => setPartIndex((i) => Math.min(parts.length - 1, i + 1))}
        />

        <SubmitBar
          attemptId={attemptId}
          audioFinishedAt={audioFinishedAt}
        />
      </div>
    </section>
  );
}

// ─── Header / status ────────────────────────────────────────────────────

function RunnerHeader({
  startedAt,
  status,
  totalQuestions,
  answeredCount,
  mode,
}: {
  startedAt: Date;
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
          / {totalQuestions} · time elapsed <ElapsedTimer startedAt={startedAt} />
        </p>
      </div>
      <StatusPill status={status} />
    </header>
  );
}

// Per-second ticker kept in its own component so the timer's re-render
// does not bubble up to ListeningPractice. Previously the timer caused
// a full-tree re-render every second, which created new inline
// callback identities on the audio panel — those re-fired the
// URL-fetch effect, reloading <audio src> and looping the audio.
function ElapsedTimer({ startedAt }: { startedAt: Date }) {
  const elapsed = useElapsedSeconds(startedAt);
  return <>{formatElapsed(elapsed)}</>;
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
  currentlyPlayingPart,
}: {
  parts: ListeningRunnerPart[];
  current: number;
  onChange: (i: number) => void;
  currentlyPlayingPart: number | null;
}) {
  return (
    <nav aria-label="Listening part" className="mb-6 flex flex-wrap gap-2">
      {parts.map((p, i) => {
        const active = i === current;
        const playing = currentlyPlayingPart === p.part;
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
            title={playing ? "Audio is currently playing this part." : undefined}
          >
            <span>Part {p.part}</span>
            <span className="font-body font-normal text-xs opacity-80">
              {p.title}
            </span>
            {playing ? (
              <span
                aria-label="now playing"
                className="font-heading font-bold text-xs"
              >
                ●▶
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

// ─── Questions list (per-active-part) ───────────────────────────────────
//
// The questions side of the page. Audio is owned globally by
// GlobalAudioPanel above; this component is presentational over the
// learner's responses for the part they are CURRENTLY VIEWING.

// A grouped render-unit. Real IELTS booklets present completion-block
// questions as one visual structure (form / notes / table) with the
// question numbers IN the blanks, and consecutive sentence-completion
// questions under one shared instruction header. Rendering each question
// as its own isolated card — what we did before — was a learning-app UI,
// not an IELTS UI.
type RenderUnit =
  | {
      kind: "completion-block";
      block: ListeningRunnerBlock;
      slotToQuestion: Map<string, ListeningRunnerQuestion>;
      firstPosition: number;
      lastPosition: number;
    }
  | {
      kind: "sentence-completion-group";
      questions: ListeningRunnerQuestion[];
      sharedPrompt: string;
    }
  | { kind: "question"; question: ListeningRunnerQuestion };

function buildRenderUnits(
  questions: ListeningRunnerQuestion[],
  blocks: ListeningRunnerBlock[],
): RenderUnit[] {
  const sorted = [...questions].sort((a, b) => a.position - b.position);
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const units: RenderUnit[] = [];
  const emittedBlocks = new Set<string>();
  let i = 0;
  while (i < sorted.length) {
    const q = sorted[i]!;
    const payload = q.payload;

    // Completion-blank → emit the parent block ONCE at the position
    // of the first question that references it; subsequent
    // completion-blank questions for the same block are swallowed
    // (they'll render as their numbered slots inside the block).
    if (payload.kind === "listening-completion-blank") {
      const block = blockById.get(payload.block_id);
      if (block && !emittedBlocks.has(payload.block_id)) {
        const slotToQuestion = new Map<string, ListeningRunnerQuestion>();
        const positions: number[] = [];
        for (const q2 of sorted) {
          if (
            q2.payload.kind === "listening-completion-blank" &&
            q2.payload.block_id === payload.block_id
          ) {
            slotToQuestion.set(q2.payload.slot_id, q2);
            positions.push(q2.position);
          }
        }
        units.push({
          kind: "completion-block",
          block,
          slotToQuestion,
          firstPosition: Math.min(...positions),
          lastPosition: Math.max(...positions),
        });
        emittedBlocks.add(payload.block_id);
      }
      i++;
      continue;
    }

    // Sentence-completion → group consecutive questions with the
    // SAME prompt under one IELTS-style instruction header.
    if (payload.kind === "listening-sentence-completion") {
      const sharedPrompt = q.prompt;
      const group: ListeningRunnerQuestion[] = [q];
      let j = i + 1;
      while (j < sorted.length) {
        const next = sorted[j]!;
        if (
          next.payload.kind === "listening-sentence-completion" &&
          next.prompt === sharedPrompt
        ) {
          group.push(next);
          j++;
        } else {
          break;
        }
      }
      if (group.length > 1) {
        units.push({
          kind: "sentence-completion-group",
          questions: group,
          sharedPrompt,
        });
        i = j;
        continue;
      }
      // Single sentence-completion falls through to standalone card.
    }

    units.push({ kind: "question", question: q });
    i++;
  }
  return units;
}

function questionRange(positions: readonly number[]): string {
  if (positions.length === 0) return "";
  const min = Math.min(...positions);
  const max = Math.max(...positions);
  if (min === max) return `${min + 1}`;
  return `${min + 1}–${max + 1}`;
}

function QuestionsList({
  part,
  questions,
  responses,
  onChange,
}: {
  part: ListeningRunnerPart;
  questions: ListeningRunnerQuestion[];
  responses: Record<string, ClientListeningResponse>;
  onChange: (questionId: string, next: ClientListeningResponse) => void;
}) {
  const blockById = useMemo(() => {
    const m = new Map<string, ListeningRunnerBlock>();
    for (const b of part.completion_blocks) m.set(b.id, b);
    return m;
  }, [part]);

  const units = useMemo(
    () => buildRenderUnits(questions, part.completion_blocks),
    [questions, part.completion_blocks],
  );

  return (
    <article aria-label={`Part ${part.part} questions`} className="space-y-5">
      <header>
        <p className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
          Part {part.part} · {part.context}
        </p>
        <h2 className="mt-1 font-heading font-bold text-xl text-brand-black">
          {part.title}{" "}
          <span className="font-body font-normal text-sm text-brand-grey-600">
            · answer {questions.length} as the recording plays
          </span>
        </h2>
      </header>

      <ol className="space-y-5">
        {units.map((unit) => {
          if (unit.kind === "completion-block") {
            return (
              <li
                key={`block-${unit.block.id}`}
                className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-5 space-y-3"
              >
                <CompletionBlockGroupHeader
                  block={unit.block}
                  firstPosition={unit.firstPosition}
                  lastPosition={unit.lastPosition}
                />
                <CompletionBlockView
                  block={unit.block}
                  slotToQuestion={unit.slotToQuestion}
                  responses={responses}
                  onChange={onChange}
                />
              </li>
            );
          }
          if (unit.kind === "sentence-completion-group") {
            return (
              <li
                key={`sc-group-${unit.questions[0]!.id}`}
                className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-5 space-y-3"
              >
                <SentenceCompletionGroupHeader
                  positions={unit.questions.map((q) => q.position)}
                  sharedPrompt={unit.sharedPrompt}
                />
                <ol className="space-y-3">
                  {unit.questions.map((q) => (
                    <SentenceCompletionRow
                      key={q.id}
                      question={q}
                      value={responses[q.id]}
                      onChange={onChange}
                    />
                  ))}
                </ol>
              </li>
            );
          }
          const q = unit.question;
          return (
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
          );
        })}
      </ol>
    </article>
  );
}

// Strict-mode audio panel: a single "Begin Part N audio" button that
// chains every speech / narration segment with its declared reading-
// pause silences, plays once, and cannot be paused / scrubbed / restarted.
// Reading-ahead and post-part check pauses come through as honest silent
// gaps so the timing matches the real exam.
// ─── Global audio panel (one playback chain across all 4 parts) ─────────
//
// Real IELTS Listening is ONE continuous 30-minute recording. The
// learner clicks Begin once and the whole section plays through:
// narrator's intros, the four parts' transcripts, the silent reading
// pauses, all in order. This component owns that single playback chain.
//
// Per-part tabs above the questions panel are purely a viewing nav —
// they don't gate audio. When the playback crosses a part boundary
// we call onPartChange so the parent can auto-follow with the visible
// tab.

type GlobalPlaylistItem =
  | { type: "audio"; sha256: string; partNumber: number }
  | { type: "missing-audio"; partNumber: number }
  | {
      type: "pause";
      seconds: number;
      label: "reading" | "preview";
      partNumber: number;
    };

function buildGlobalPlaylist(
  parts: ListeningRunnerPart[],
): GlobalPlaylistItem[] {
  const out: GlobalPlaylistItem[] = [];
  for (const part of parts) {
    for (const seg of part.transcript) {
      if (seg.kind === "speech" || seg.kind === "narration") {
        if (seg.audio_sha256) {
          out.push({
            type: "audio",
            sha256: seg.audio_sha256,
            partNumber: part.part,
          });
        } else {
          out.push({ type: "missing-audio", partNumber: part.part });
        }
      } else if (seg.kind === "reading-pause") {
        out.push({
          type: "pause",
          seconds: seg.seconds,
          label: "reading",
          partNumber: part.part,
        });
      } else if (seg.kind === "questions-preview") {
        out.push({
          type: "pause",
          seconds: seg.seconds,
          label: "preview",
          partNumber: part.part,
        });
      }
    }
  }
  return out;
}

function GlobalAudioPanel({
  attemptId,
  parts,
  onPartChange,
  onFinished,
}: {
  attemptId: string;
  parts: ListeningRunnerPart[];
  onPartChange: (partNumber: number) => void;
  onFinished: () => void;
}) {
  const [playState, setPlayState] = useState<
    "idle" | "playing" | "finished" | "error"
  >("idle");
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playlist = useMemo(() => buildGlobalPlaylist(parts), [parts]);

  // Total speech + per-part-with-audio counts so we can show "1 of 4
  // parts has no audio at all" loudly in the panel.
  const audioStatus = useMemo(() => {
    const perPart = new Map<
      number,
      { speech: number; withAudio: number }
    >();
    for (const part of parts) {
      let speech = 0;
      let withAudio = 0;
      for (const seg of part.transcript) {
        if (seg.kind === "speech" || seg.kind === "narration") {
          speech += 1;
          if (seg.audio_sha256) withAudio += 1;
        }
      }
      perPart.set(part.part, { speech, withAudio });
    }
    let totalSpeech = 0;
    let totalWithAudio = 0;
    const fullySilentParts: number[] = [];
    for (const [partNumber, stats] of perPart) {
      totalSpeech += stats.speech;
      totalWithAudio += stats.withAudio;
      if (stats.speech > 0 && stats.withAudio === 0)
        fullySilentParts.push(partNumber);
    }
    return {
      totalSpeech,
      totalWithAudio,
      missing: totalSpeech - totalWithAudio,
      fullySilentParts,
    };
  }, [parts]);

  // Drive a pure-by-construction advance: compute next state outside
  // the setSegmentIndex updater so React strict-mode's double-invoke
  // can't trigger side effects.
  const advance = useCallback(() => {
    const next = segmentIndex + 1;
    if (next >= playlist.length) {
      setPlayState("finished");
      onFinished();
    } else {
      setSegmentIndex(next);
    }
  }, [playlist.length, segmentIndex, onFinished]);

  // Pause / missing-audio timer effect — same shape as before.
  useEffect(() => {
    if (playState !== "playing") return;
    const item = playlist[segmentIndex];
    if (!item) return;
    let delayMs: number | null = null;
    if (item.type === "pause") delayMs = item.seconds * 1000;
    else if (item.type === "missing-audio") delayMs = 1000;
    if (delayMs === null) return;
    const handle = setTimeout(() => advance(), delayMs);
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

  // Notify parent when the current playlist item enters a new part, so
  // the visible tab auto-follows the audio.
  const currentItem = playState === "playing" ? playlist[segmentIndex] : null;
  const currentPartNumber = currentItem ? currentItem.partNumber : null;
  useEffect(() => {
    if (currentPartNumber !== null) onPartChange(currentPartNumber);
  }, [currentPartNumber, onPartChange]);

  const start = useCallback(() => {
    if (playState !== "idle") return;
    setPlayState("playing");
    setError(null);
    setSegmentIndex(0);
  }, [playState]);

  const totalParts = parts.length;
  const playingPartIndex = currentPartNumber
    ? parts.findIndex((p) => p.part === currentPartNumber)
    : -1;

  return (
    <article className="rounded-lg bg-brand-black text-white p-6 space-y-4 mb-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="font-body text-xs uppercase tracking-widest text-brand-red">
            Listening section · single continuous playback
          </p>
          <h2 className="mt-1 font-heading font-bold text-xl text-white">
            {playState === "idle"
              ? "All four parts will play once, end to end."
              : playState === "playing"
                ? `Playing Part ${currentPartNumber ?? "?"} (segment ${segmentIndex + 1} of ${playlist.length})`
                : "Listening section finished."}
          </h2>
        </div>
        {audioStatus.missing > 0 && audioStatus.totalWithAudio > 0 ? (
          <p className="font-body text-xs text-brand-red max-w-xs text-right">
            ⚠ {audioStatus.missing} of {audioStatus.totalSpeech} speech
            segments have no audio.
          </p>
        ) : null}
      </header>

      {audioStatus.fullySilentParts.length > 0 ? (
        <div className="rounded-md bg-brand-red/20 ring-1 ring-brand-red/60 p-4">
          <p className="font-heading font-bold text-sm text-white">
            No audio for Part
            {audioStatus.fullySilentParts.length === 1 ? "" : "s"}{" "}
            {audioStatus.fullySilentParts.join(", ")}.
          </p>
          <p className="mt-1 font-body text-sm text-white/80">
            TTS synth failed for {audioStatus.fullySilentParts.length === 1 ? "this part" : "these parts"}.
            Ask a SuperAdmin to open the moderation page and click{" "}
            <em>Re-synthesise missing clips</em>. Playback will skip the
            silent segments and continue.
          </p>
        </div>
      ) : null}

      {playState === "idle" ? (
        <button
          type="button"
          onClick={start}
          className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black"
        >
          ▶ Begin Listening section
        </button>
      ) : null}

      {playState === "playing" && currentItem ? (
        <div className="space-y-2">
          {currentItem.type === "audio" ? (
            <StrictAudioSegment
              attemptId={attemptId}
              sha256={currentItem.sha256}
              audioRef={audioRef}
              onEnded={() => advance()}
              onError={() => setError("Audio failed to load.")}
            />
          ) : currentItem.type === "pause" ? (
            <PauseCountdown
              key={segmentIndex}
              seconds={currentItem.seconds}
              label={currentItem.label}
            />
          ) : currentItem.type === "missing-audio" ? (
            <p className="font-body text-xs italic text-brand-red">
              [no audio for this segment — skipping]
            </p>
          ) : null}
          {playingPartIndex >= 0 ? (
            <p className="font-body text-xs text-white/60">
              Part {currentPartNumber} of {totalParts} in progress.
            </p>
          ) : null}
        </div>
      ) : null}

      {playState === "finished" ? (
        <p className="font-body text-sm text-white/80">
          That&apos;s the whole Listening section. Scroll down to review
          your answers and submit.
        </p>
      ) : null}

      {error ? (
        <p className="font-body text-sm text-brand-red">{error}</p>
      ) : null}

      <p className="font-body text-xs text-white/60">
        Exam mode: audio plays once. No pause, no rewind. Flip between
        part tabs below to view any part&apos;s questions while the
        recording plays.
      </p>
    </article>
  );
}

function PauseCountdown({
  seconds,
  label,
}: {
  seconds: number;
  label: "reading" | "preview";
}) {
  // Visible per-second countdown so the learner sees "this is a real
  // 30-second exam silence" and not "the player froze." Re-mounts via
  // the parent's `key` whenever a new pause segment starts, so the
  // countdown always begins at the right number.
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => {
    if (remaining <= 0) return;
    const id = setTimeout(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearTimeout(id);
  }, [remaining]);
  const headline =
    label === "preview"
      ? "Reading time — look ahead at the questions"
      : "Silent pause — check your answers";
  return (
    <div className="space-y-1">
      <p className="font-heading font-bold text-sm text-white">{headline}</p>
      <p className="font-body text-xs italic text-white/70">
        {remaining}s remaining…
      </p>
    </div>
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
  // Callback refs so the URL-fetch effect's dependency list stays
  // stable across parent re-renders. Previously `onError` lived in the
  // effect's deps and changed identity on every parent re-render,
  // causing the signed URL to be re-fetched and the <audio src> to
  // reload — which restarted playback in a tight loop.
  const onErrorRef = useRef(onError);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onErrorRef.current = onError;
    onEndedRef.current = onEnded;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await issueSignedAudioUrl(attemptId, sha256);
        if (cancelled) return;
        if (res.ok) setUrl(res.url);
        else onErrorRef.current();
      } catch {
        if (!cancelled) onErrorRef.current();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attemptId, sha256]);

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
      onEnded={() => onEndedRef.current()}
      onError={() => onErrorRef.current()}
      // No `controls` attribute. The strict mode envelope hides the
      // affordance; the audio element still exists in the DOM and
      // determined users will find ways around it.
    />
  );
}

// ─── IELTS-booklet group renderers ──────────────────────────────────────

function CompletionBlockGroupHeader({
  block,
  firstPosition,
  lastPosition,
}: {
  block: ListeningRunnerBlock;
  firstPosition: number;
  lastPosition: number;
}) {
  const range =
    firstPosition === lastPosition
      ? `Question ${firstPosition + 1}`
      : `Questions ${firstPosition + 1}–${lastPosition + 1}`;
  return (
    <header className="space-y-1 border-b border-brand-grey-200 pb-3">
      <p className="font-heading font-bold text-sm text-brand-black">{range}</p>
      {block.title ? (
        <p className="font-heading font-bold text-base text-brand-black">
          {block.title}
        </p>
      ) : null}
      {block.instructions ? (
        <p className="font-body text-xs italic text-brand-grey-700">
          {block.instructions}
        </p>
      ) : null}
    </header>
  );
}

function SentenceCompletionGroupHeader({
  positions,
  sharedPrompt,
}: {
  positions: number[];
  sharedPrompt: string;
}) {
  return (
    <header className="space-y-1 border-b border-brand-grey-200 pb-3">
      <p className="font-heading font-bold text-sm text-brand-black">
        Questions {questionRange(positions)}
      </p>
      <p className="font-body text-xs italic text-brand-grey-700">
        {sharedPrompt}
      </p>
    </header>
  );
}

function SentenceCompletionRow({
  question,
  value,
  onChange,
}: {
  question: ListeningRunnerQuestion;
  value: ClientListeningResponse | undefined;
  onChange: (questionId: string, next: ClientListeningResponse) => void;
}) {
  if (question.payload.kind !== "listening-sentence-completion") {
    return null;
  }
  const stem = question.payload.stem;
  const wordLimit = question.payload.word_limit;
  const text =
    value && value.kind === "listening-sentence-completion" ? value.text : "";
  const [before, after] = stem.split("___", 2);
  return (
    <li className="flex items-start gap-3">
      <span className="inline-flex items-center justify-center min-w-[2.25rem] h-9 rounded-pill bg-brand-black font-heading font-bold text-sm text-white px-2">
        {question.position + 1}
      </span>
      <div className="flex-1 space-y-1">
        <p className="font-body text-sm text-brand-grey-900 leading-relaxed">
          {before}
          <input
            id={question.id}
            type="text"
            value={text}
            onChange={(e) =>
              onChange(question.id, {
                kind: "listening-sentence-completion",
                text: e.target.value,
              })
            }
            aria-label={`Question ${question.position + 1} answer`}
            className="mx-2 inline-block min-w-[8rem] rounded-md ring-1 ring-brand-grey-300 bg-white px-2 py-1 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
          />
          {after ?? ""}
        </p>
        <p className="font-body text-xs text-brand-grey-500">
          Up to {wordLimit} word{wordLimit === 1 ? "" : "s"}.
        </p>
      </div>
    </li>
  );
}

// Renders a completion block (form / notes / table / flow-chart /
// summary / diagram) as ONE visual unit with the question numbers inside
// the blanks — closer to a real IELTS booklet than the old "one card per
// blank" view. Each blank cell looks up its question from slotToQuestion
// and renders a numbered input.
function CompletionBlockView({
  block,
  slotToQuestion,
  responses,
  onChange,
}: {
  block: ListeningRunnerBlock;
  slotToQuestion: Map<string, ListeningRunnerQuestion>;
  responses: Record<string, ClientListeningResponse>;
  onChange: (questionId: string, next: ClientListeningResponse) => void;
}) {
  // table layout uses an actual <table>; everything else uses a
  // form-flavoured stack of label/input rows. Real flow-chart and
  // diagram are out of scope for v1 — the fallback still surfaces the
  // numbered inputs in row order, which is functional even if not
  // visually perfect.
  if (block.layout === "table") {
    return (
      <TableCompletionView
        block={block}
        slotToQuestion={slotToQuestion}
        responses={responses}
        onChange={onChange}
      />
    );
  }
  return (
    <FormCompletionView
      block={block}
      slotToQuestion={slotToQuestion}
      responses={responses}
      onChange={onChange}
    />
  );
}

function TableCompletionView({
  block,
  slotToQuestion,
  responses,
  onChange,
}: {
  block: ListeningRunnerBlock;
  slotToQuestion: Map<string, ListeningRunnerQuestion>;
  responses: Record<string, ClientListeningResponse>;
  onChange: (questionId: string, next: ClientListeningResponse) => void;
}) {
  const headerRows = block.rows.filter((r) => r.is_header);
  const bodyRows = block.rows.filter((r) => !r.is_header);
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        {headerRows.length > 0 ? (
          <thead>
            {headerRows.map((row, ri) => (
              <tr key={`h-${ri}`}>
                {row.cells.map((cell, ci) => (
                  <th
                    key={ci}
                    className="border border-brand-grey-300 bg-brand-grey-50 px-3 py-2 text-left font-heading font-bold text-brand-black"
                  >
                    {row.label && ci === 0 ? `${row.label}` : null}
                    <CellContents
                      cell={cell}
                      slotToQuestion={slotToQuestion}
                      responses={responses}
                      onChange={onChange}
                    />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
        ) : null}
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={`b-${ri}`}>
              {row.label && row.cells.length > 0 ? (
                <th
                  scope="row"
                  className="border border-brand-grey-300 px-3 py-2 text-left font-heading font-bold text-brand-grey-900"
                >
                  {row.label}
                </th>
              ) : null}
              {row.cells.map((cell, ci) => (
                <td
                  key={ci}
                  className="border border-brand-grey-300 px-3 py-2 align-top"
                >
                  <CellContents
                    cell={cell}
                    slotToQuestion={slotToQuestion}
                    responses={responses}
                    onChange={onChange}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormCompletionView({
  block,
  slotToQuestion,
  responses,
  onChange,
}: {
  block: ListeningRunnerBlock;
  slotToQuestion: Map<string, ListeningRunnerQuestion>;
  responses: Record<string, ClientListeningResponse>;
  onChange: (questionId: string, next: ClientListeningResponse) => void;
}) {
  return (
    <ul className="space-y-2">
      {block.rows.map((row, ri) => (
        <li
          key={ri}
          className={
            row.is_header
              ? "font-heading font-bold text-sm text-brand-black"
              : "grid grid-cols-[minmax(8rem,auto)_1fr] gap-3 items-baseline"
          }
        >
          {row.label ? (
            <span
              className={
                row.is_header
                  ? "font-heading font-bold text-sm text-brand-black"
                  : "font-body text-sm text-brand-grey-900"
              }
            >
              {row.label}
            </span>
          ) : (
            <span aria-hidden="true" />
          )}
          <span className="font-body text-sm text-brand-grey-900 leading-relaxed">
            {row.cells.map((cell, ci) => (
              <CellContents
                key={ci}
                cell={cell}
                slotToQuestion={slotToQuestion}
                responses={responses}
                onChange={onChange}
              />
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Per-cell renderer: text segments stream as inline prose; blank
// segments look up the matching question and render a numbered input.
function CellContents({
  cell,
  slotToQuestion,
  responses,
  onChange,
}: {
  cell: ListeningRunnerCell[];
  slotToQuestion: Map<string, ListeningRunnerQuestion>;
  responses: Record<string, ClientListeningResponse>;
  onChange: (questionId: string, next: ClientListeningResponse) => void;
}) {
  return (
    <>
      {cell.map((seg, i) => {
        if (seg.kind === "text") {
          return <span key={i}>{seg.text}</span>;
        }
        const question = slotToQuestion.get(seg.slot_id);
        if (!question) {
          return (
            <span
              key={i}
              className="font-body text-xs italic text-brand-red mx-1"
            >
              [missing slot: {seg.slot_id}]
            </span>
          );
        }
        const value = responses[question.id];
        const text =
          value && value.kind === "listening-completion-blank" ? value.text : "";
        const wordLimit =
          question.payload.kind === "listening-completion-blank"
            ? question.payload.word_limit
            : 1;
        return (
          <span
            key={i}
            className="inline-flex items-baseline gap-1 mx-1 align-baseline"
          >
            <span className="inline-flex items-center justify-center min-w-[1.75rem] h-6 rounded-pill bg-brand-black font-heading font-bold text-xs text-white px-1.5">
              {question.position + 1}
            </span>
            <input
              type="text"
              value={text}
              onChange={(e) =>
                onChange(question.id, {
                  kind: "listening-completion-blank",
                  text: e.target.value,
                })
              }
              aria-label={`Question ${question.position + 1} answer (max ${wordLimit} word${wordLimit === 1 ? "" : "s"})`}
              title={`Up to ${wordLimit} word${wordLimit === 1 ? "" : "s"}`}
              className="inline-block min-w-[7rem] rounded-md ring-1 ring-brand-grey-300 bg-white px-2 py-1 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
            />
          </span>
        );
      })}
    </>
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

// 10-minute window after the audio finishes before we auto-submit. Real
// IELTS gives 10 minutes at the end for the learner to transfer their
// answers; we give them 10 minutes to review + click Submit and then
// fire it ourselves so the test doesn't sit half-done forever.
const AUTO_SUBMIT_WINDOW_MS = 10 * 60 * 1000;

function SubmitBar({
  attemptId,
  audioFinishedAt,
}: {
  attemptId: string;
  audioFinishedAt: number | null;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const autoFiredRef = useRef(false);
  const deadline =
    audioFinishedAt !== null ? audioFinishedAt + AUTO_SUBMIT_WINDOW_MS : null;
  const remaining = useCountdown(deadline);

  // Auto-submit when the deadline lapses. requestSubmit() goes through
  // the same code path as the user click so all the server-action
  // wiring stays consistent.
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (remaining === null) return;
    if (remaining > 0) return;
    autoFiredRef.current = true;
    formRef.current?.requestSubmit();
  }, [remaining]);

  return (
    <form
      ref={formRef}
      action={submitListeningAttempt}
      className="mt-10 rounded-lg bg-brand-black text-white p-6 flex flex-wrap items-center justify-between gap-4"
    >
      <input type="hidden" name="attemptId" value={attemptId} />
      <div>
        <p className="font-heading font-bold text-lg">
          {audioFinishedAt === null
            ? "Submit when the audio is done."
            : "Check your answers and submit."}
        </p>
        <p className="font-body text-sm text-white/70">
          {audioFinishedAt === null ? (
            <>
              Listening is auto-graded — you&apos;ll see your raw score, band,
              and per-question feedback on the next screen.
            </>
          ) : (
            <>
              Auto-submit in{" "}
              <span className="font-heading font-bold text-white">
                {formatRemaining(remaining ?? 0)}
              </span>{" "}
              if you don&apos;t click first.
            </>
          )}
        </p>
      </div>
      <SubmitButton autoFiring={remaining !== null && remaining <= 0} />
    </form>
  );
}

function SubmitButton({ autoFiring }: { autoFiring: boolean }) {
  const { pending } = useFormStatus();
  const label = autoFiring
    ? "Auto-submitting…"
    : pending
      ? "Submitting…"
      : "Submit Listening";
  return (
    <button
      type="submit"
      disabled={pending || autoFiring}
      className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black"
    >
      {label}
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

// Returns the milliseconds remaining until `deadline`, or null if there
// is no deadline set. Ticks once per second so a visible countdown
// stays in sync without churning the parent tree.
function useCountdown(deadline: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  if (deadline === null) return null;
  return Math.max(0, deadline - now);
}

function formatRemaining(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const mm = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
