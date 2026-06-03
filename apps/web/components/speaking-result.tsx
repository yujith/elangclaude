// Result view for a finished Speaking attempt.
//
// Three top-of-page states:
//   - `grade` present → band hero + 4-criterion breakdown + strengths +
//     improvements (mirrors components/grade-summary.tsx for Writing).
//   - `grade` null, `gradeError` set → "Grading hit a snag" with a retry
//     form that re-runs `regradeSpeakingAttempt`.
//   - both null → transitional "grading is processing" card.
//
// Below the grade panel: playback (if R2 download was reachable), the
// IELTS content the candidate was responding to, and the per-part
// transcript.

import Link from "next/link";
import type { SpeakingGrade } from "@elc/ai";
import {
  renderCueCard,
  type SpeakingContent,
} from "@/lib/speaking/content";
import { regradeSpeakingAttempt } from "@/lib/speaking/actions";
import { SubmitButton } from "@/components/ui/submit-button";

type GradeError = "quota" | "grading" | "unknown" | "shape" | null;

type Props = {
  attemptId: string;
  content: SpeakingContent | null;
  transcripts: { part1: string; part2: string; part3: string };
  audioUrl: string | null;
  durationSec: number | null;
  grade: SpeakingGrade | null;
  gradeError: GradeError;
};

const CRITERION_LABELS: Record<keyof SpeakingGrade["criteria"], string> = {
  fluency_coherence: "Fluency & Coherence",
  lexical_resource: "Lexical Resource",
  grammatical_range: "Grammatical Range & Accuracy",
  pronunciation: "Pronunciation",
};

function bandLabel(n: number): string {
  return n.toFixed(1);
}

function formatDuration(sec: number | null): string {
  if (!sec || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function SpeakingResult({
  attemptId,
  content,
  transcripts,
  audioUrl,
  durationSec,
  grade,
  gradeError,
}: Props) {
  return (
    <section className="bg-brand-grey-50 px-6 py-12 md:py-16">
      <div className="mx-auto max-w-4xl space-y-8">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Speaking · result
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            {grade ? "Here’s where you landed." : "Recording submitted."}
          </h1>
          {!grade && !gradeError ? (
            <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
              Your conversation has been transcribed and saved. The AI
              examiner is grading it now — refresh in a moment.
            </p>
          ) : null}
        </header>

        {grade ? (
          <GradePanel grade={grade} />
        ) : gradeError ? (
          <GradeErrorPanel attemptId={attemptId} error={gradeError} />
        ) : (
          <PendingPanel />
        )}

        {audioUrl ? (
          <article className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-3">
            <div className="flex items-baseline justify-between flex-wrap gap-3">
              <h2 className="font-heading font-bold text-xl text-brand-black">
                Play back your conversation
              </h2>
              {durationSec ? (
                <span className="font-body text-sm text-brand-grey-500 tabular-nums">
                  {formatDuration(durationSec)}
                </span>
              ) : null}
            </div>
            <audio
              controls
              src={audioUrl}
              className="w-full"
              preload="metadata"
            />
          </article>
        ) : (
          <article className="rounded-lg bg-brand-grey-50 ring-1 ring-brand-grey-200 p-6">
            <p className="font-body text-sm text-brand-grey-700">
              Playback isn&apos;t available for this attempt — the recording
              storage isn&apos;t reachable right now.
            </p>
          </article>
        )}

        {content ? (
          <article className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-4">
            <h2 className="font-heading font-bold text-xl text-brand-black">
              What you were responding to
            </h2>
            <div className="space-y-3">
              <div>
                <h3 className="font-heading font-bold text-sm uppercase tracking-wide text-brand-grey-500 mb-1">
                  Part 1 — Interview
                </h3>
                <p className="font-body text-sm text-brand-grey-800">
                  {content.part1.theme}
                </p>
              </div>
              <div>
                <h3 className="font-heading font-bold text-sm uppercase tracking-wide text-brand-grey-500 mb-1">
                  Part 2 — Long turn
                </h3>
                <pre className="font-body text-sm text-brand-grey-800 leading-relaxed whitespace-pre-wrap bg-brand-grey-50 rounded-md ring-1 ring-brand-grey-200 p-4">
                  {renderCueCard(content.part2)}
                </pre>
              </div>
              <div>
                <h3 className="font-heading font-bold text-sm uppercase tracking-wide text-brand-grey-500 mb-1">
                  Part 3 — Discussion
                </h3>
                <p className="font-body text-sm text-brand-grey-800">
                  {content.part3.theme}
                </p>
              </div>
            </div>
          </article>
        ) : null}

        <article className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-5">
          <h2 className="font-heading font-bold text-xl text-brand-black">
            Your transcript
          </h2>
          <TranscriptBlock title="Part 1 — Interview" text={transcripts.part1} />
          <TranscriptBlock title="Part 2 — Long turn" text={transcripts.part2} />
          <TranscriptBlock title="Part 3 — Discussion" text={transcripts.part3} />
        </article>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/practice/speaking"
            className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
          >
            Back to Speaking practice
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─── Grade panels ────────────────────────────────────────────────────────

function GradePanel({ grade }: { grade: SpeakingGrade }) {
  return (
    <div className="space-y-8">
      <section className="rounded-lg bg-brand-black text-white p-8 md:p-12 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div>
          <p className="font-body text-sm uppercase tracking-widest text-brand-grey-200">
            Speaking
          </p>
          <p className="font-heading font-bold text-xl mt-1">Overall band</p>
        </div>
        <p className="font-display italic font-bold text-7xl md:text-8xl leading-none text-brand-red tabular-nums">
          {bandLabel(grade.band_overall)}
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-heading font-bold text-2xl text-brand-black">
          Criterion breakdown
        </h2>
        <ul className="space-y-3">
          {(
            Object.keys(CRITERION_LABELS) as (keyof SpeakingGrade["criteria"])[]
          ).map((key) => {
            const row = grade.criteria[key];
            return (
              <li
                key={key}
                className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-5 flex flex-col md:flex-row md:items-start md:gap-6"
              >
                <div className="md:w-56 shrink-0 flex md:flex-col md:items-start justify-between md:justify-start gap-3 md:gap-1 mb-3 md:mb-0">
                  <p className="font-heading font-bold text-sm text-brand-grey-700">
                    {CRITERION_LABELS[key]}
                  </p>
                  <p className="font-display italic font-bold text-3xl text-brand-black tabular-nums">
                    {bandLabel(row.band)}
                  </p>
                </div>
                <div className="flex-1 space-y-2">
                  <p className="font-body text-base text-brand-grey-900 leading-relaxed">
                    {row.justification}
                  </p>
                  <blockquote className="font-body italic text-sm text-brand-grey-700 border-l-4 border-brand-red pl-3">
                    {row.evidence}
                  </blockquote>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
          <h3 className="font-heading font-bold text-lg text-brand-black mb-3">
            Strengths
          </h3>
          <ul className="space-y-2 font-body text-base text-brand-grey-900">
            {grade.strengths.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden="true" className="text-brand-red font-bold">
                  ✓
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
          <h3 className="font-heading font-bold text-lg text-brand-black mb-3">
            What to work on next
          </h3>
          <ul className="space-y-2 font-body text-base text-brand-grey-900">
            {grade.improvements.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden="true" className="text-brand-red font-bold">
                  →
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 font-body text-sm text-brand-grey-500">
            Suggested drill:{" "}
            <span className="font-heading font-bold text-brand-grey-900">
              {grade.next_drill}
            </span>
          </p>
        </div>
      </section>
    </div>
  );
}

function GradeErrorPanel({
  attemptId,
  error,
}: {
  attemptId: string;
  error: NonNullable<GradeError>;
}) {
  const body =
    error === "quota"
      ? "Your daily AI quota has been used up. It resets at midnight UTC. Your recording and transcript are saved — you can try grading it again then."
      : error === "shape"
        ? "The AI examiner returned a grade we couldn't read. Try grading again — if it keeps failing, your admin will see it in the logs."
        : error === "grading"
          ? "The AI examiner couldn't finish grading this attempt. Your recording and transcript are saved — try again, or let your admin know."
          : "Something went wrong grading this attempt. Your recording and transcript are saved.";
  return (
    <article className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-4">
      <h2 className="font-heading font-bold text-xl text-brand-black">
        Grading hit a snag
      </h2>
      <p className="font-body text-base text-brand-grey-900">{body}</p>
      {error !== "quota" ? (
        <form action={regradeSpeakingAttempt}>
          <input type="hidden" name="attemptId" value={attemptId} />
          <SubmitButton
            pendingLabel="Grading…"
            className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Try grading again
          </SubmitButton>
        </form>
      ) : null}
    </article>
  );
}

function PendingPanel() {
  return (
    <article className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-2">
      <h2 className="font-heading font-bold text-xl text-brand-black">
        Grading in progress
      </h2>
      <p className="font-body text-base text-brand-grey-700">
        The AI examiner is scoring your conversation. Refresh the page in a
        moment to see the breakdown.
      </p>
    </article>
  );
}

// ─── Transcript helpers ──────────────────────────────────────────────────

function TranscriptBlock({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div>
      <h3 className="font-heading font-bold text-sm uppercase tracking-wide text-brand-grey-500 mb-2">
        {title}
      </h3>
      {text.trim().length > 0 ? (
        <p className="font-body text-base text-brand-grey-900 leading-relaxed whitespace-pre-wrap">
          {text}
        </p>
      ) : (
        <p className="font-body text-sm text-brand-grey-500 italic">
          No words transcribed in this part.
        </p>
      )}
    </div>
  );
}
