"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { autosaveAttempt, submitAttempt } from "@/lib/attempts/actions";
import {
  countWords,
  taskShortLabel,
  timeAllocationMinutes,
  wordTarget,
  type WritingTaskType,
} from "@/lib/writing/task";
import { parseVisual } from "@/lib/writing/visual";
import { TaskVisual } from "@/components/task-visual";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type Props = {
  attemptId: string;
  taskType: WritingTaskType;
  promptText: string;
  visualJson: unknown;
  initialResponse: string;
  initialSavedAtIso: string | null;
  startedAtIso: string;
};

const AUTOSAVE_DEBOUNCE_MS = 1500;

export function WritingPractice({
  attemptId,
  taskType,
  promptText,
  visualJson,
  initialResponse,
  initialSavedAtIso,
  startedAtIso,
}: Props) {
  // Parse once per visualJson change. Returns null for missing / malformed
  // specs — the UI silently falls back to text-only when null.
  const visual = useMemo(() => parseVisual(visualJson), [visualJson]);
  const [text, setText] = useState(initialResponse);
  const [savedAt, setSavedAt] = useState<string | null>(initialSavedAtIso);
  const [status, setStatus] = useState<SaveStatus>("idle");

  // Single-flight autosave: only one save in flight at a time. While a save
  // is running, the latest debounced text lands in pendingTextRef. When the
  // in-flight save resolves, we fire the pending one (if any). This means
  // even rapid typing produces at most one save per round-trip, never two
  // concurrent writes to the same Answer row.
  const inFlightRef = useRef(false);
  const pendingTextRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedTextRef = useRef<string>(initialResponse);

  async function flushSave(value: string) {
    if (inFlightRef.current) {
      // A save is already running; remember the latest and let the
      // tail-call drain it.
      pendingTextRef.current = value;
      return;
    }
    if (value === lastSavedTextRef.current) {
      // Nothing changed since the last successful save — skip the round-trip.
      return;
    }
    inFlightRef.current = true;
    setStatus("saving");
    try {
      const res = await autosaveAttempt(attemptId, value);
      if (res.ok) {
        lastSavedTextRef.current = value;
        setSavedAt(res.savedAt);
        setStatus("saved");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    } finally {
      inFlightRef.current = false;
      const queued = pendingTextRef.current;
      pendingTextRef.current = null;
      if (queued !== null) {
        // Drain the latest pending value with the same single-flight rule.
        void flushSave(queued);
      }
    }
  }

  // Debounce: schedule a save 1500ms after the last keystroke. If the user
  // keeps typing, the timer resets.
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      void flushSave(text);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Word count + timer math.
  const words = countWords(text);
  const target = wordTarget(taskType);
  const minutes = timeAllocationMinutes(taskType);
  const elapsedMs = useElapsed(startedAtIso);
  const remainingMs = minutes * 60_000 - elapsedMs;
  const timerLabel = formatRemaining(remainingMs);
  const overTime = remainingMs <= 0;
  const belowTarget = words < target;

  const savedAgo = useSavedAgo(savedAt);

  return (
    <div className="flex flex-col">
      {/* Header strip: task pill + timer */}
      <div className="bg-brand-black text-white">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center rounded-pill bg-white text-brand-black font-heading font-bold text-xs px-3 py-1">
              {taskShortLabel(taskType)}
            </span>
            <span className="font-body text-sm text-brand-grey-200 hidden sm:inline">
              Target {target} words · suggested {minutes} min
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div
              className={
                "font-heading font-bold text-2xl tabular-nums " +
                (overTime ? "text-brand-red" : "text-white")
              }
              aria-live="polite"
            >
              {timerLabel}
            </div>
          </div>
        </div>
        <div className="h-1 bg-brand-red" aria-hidden="true" />
      </div>

      <div className="mx-auto w-full max-w-7xl px-6 py-6 grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-6">
        {/* Prompt panel */}
        <section
          aria-label="Task prompt"
          className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 max-h-[70vh] overflow-y-auto"
        >
          <h2 className="font-heading font-bold text-xl text-brand-black mb-3">
            Your task
          </h2>
          {visual ? (
            <div className="mb-5">
              <TaskVisual visual={visual} />
            </div>
          ) : null}
          <p className="font-body text-base text-brand-grey-900 leading-relaxed whitespace-pre-wrap">
            {promptText}
          </p>
        </section>

        {/* Response panel — this is the form that actually submits */}
        <form
          action={submitAttempt}
          className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 flex flex-col"
        >
          <input type="hidden" name="attemptId" value={attemptId} />
          <label
            htmlFor="response"
            className="font-heading font-bold text-xl text-brand-black mb-3"
          >
            Your response
          </label>
          <textarea
            id="response"
            name="response"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck
            rows={20}
            className="flex-1 min-h-[50vh] resize-none rounded-md ring-1 ring-brand-grey-200 px-4 py-3 font-body text-base text-brand-grey-900 leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
            placeholder="Start writing here. Your draft autosaves as you type."
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm font-body text-brand-grey-700">
            <div className="flex items-center gap-3">
              <span className="font-heading font-bold text-brand-black">
                {words}
              </span>
              <span>/ {target} words</span>
              {belowTarget ? (
                <span className="inline-flex items-center rounded-pill bg-brand-red-soft text-brand-red font-heading font-bold text-xs px-2 py-0.5">
                  Below target
                </span>
              ) : (
                <span className="inline-flex items-center rounded-pill bg-brand-grey-100 text-brand-grey-700 font-heading font-bold text-xs px-2 py-0.5">
                  On target
                </span>
              )}
            </div>
            <SaveIndicator status={status} savedAgo={savedAgo} />
          </div>
          <div className="mt-6 flex items-center justify-end">
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>
  );
}

function SubmitButton() {
  // useFormStatus reads the pending state of the nearest parent <form>.
  // Lets us flip the label + disable the button while the server action
  // is in flight without managing local state.
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {pending ? "Submitting…" : "Submit response"}
    </button>
  );
}

function SaveIndicator({
  status,
  savedAgo,
}: {
  status: SaveStatus;
  savedAgo: string;
}) {
  if (status === "saving") {
    return (
      <span className="text-brand-grey-500">
        <span className="inline-block w-2 h-2 rounded-full bg-brand-grey-400 animate-pulse mr-2 align-middle" />
        Saving…
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="text-brand-red">Couldn&apos;t save — keep writing</span>
    );
  }
  if (status === "saved") {
    return <span className="text-brand-grey-500">Saved {savedAgo}</span>;
  }
  return <span className="text-brand-grey-500">Draft</span>;
}

function useElapsed(startedAtIso: string): number {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Date.now() - new Date(startedAtIso).getTime()),
  );
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.max(0, Date.now() - new Date(startedAtIso).getTime()));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAtIso]);
  return elapsed;
}

function useSavedAgo(savedAtIso: string | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!savedAtIso) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [savedAtIso]);
  if (!savedAtIso) return "";
  const seconds = Math.max(0, Math.round((now - new Date(savedAtIso).getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function formatRemaining(ms: number): string {
  const absSec = Math.max(0, Math.floor(Math.abs(ms) / 1000));
  const mm = Math.floor(absSec / 60)
    .toString()
    .padStart(2, "0");
  const ss = (absSec % 60).toString().padStart(2, "0");
  const sign = ms < 0 ? "-" : "";
  return `${sign}${mm}:${ss}`;
}
