// Result view for a finished Speaking attempt.
//
// Phase 3: shows the submitted state — playback (if R2 is wired) + the per-
// part transcripts the learner produced. The actual band-score breakdown is
// Phase 4's responsibility; this component takes a `graded` flag so when
// the grade row exists, the page can compose Phase 4's grade summary on
// top of the existing transcript/playback panels.

import Link from "next/link";
import {
  renderCueCard,
  type SpeakingContent,
} from "@/lib/speaking/content";

type Props = {
  content: SpeakingContent | null;
  transcripts: { part1: string; part2: string; part3: string };
  audioUrl: string | null;
  durationSec: number | null;
  graded: boolean;
};

function formatDuration(sec: number | null): string {
  if (!sec || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function SpeakingResult({
  content,
  transcripts,
  audioUrl,
  durationSec,
  graded,
}: Props) {
  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-4xl space-y-8">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Speaking · result
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            {graded ? "Here’s where you landed." : "Recording submitted."}
          </h1>
          {!graded ? (
            <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
              Your conversation has been transcribed and saved. AI band
              scoring for Speaking lands in the next release — your
              transcript is available below in the meantime.
            </p>
          ) : null}
        </header>

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
