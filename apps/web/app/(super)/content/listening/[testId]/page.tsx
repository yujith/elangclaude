import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withSuperAdminContext } from "@elc/db";
import {
  parseListeningContent,
  type ListeningContent,
  type ListeningPart,
} from "@elc/ai";
import { requireRole } from "@/lib/auth/context";
import {
  approveListeningTest,
  rejectListeningTest,
  resynthesiseListeningAudio,
} from "@/lib/listening/moderation-actions";

export const metadata: Metadata = {
  title: "Review Listening section",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Params = { testId: string };
type SearchParams = {
  approved?: string;
  synth_error?: string;
  synth_hint?: string;
  synth_ok?: string;
};

export default async function ReviewListeningTestPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { testId } = await params;
  const sp = await searchParams;
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);

  const test = await db.test.findUnique({
    where: { id: testId },
    select: {
      id: true,
      track: true,
      difficulty: true,
      section: true,
      status: true,
      body_json: true,
      createdAt: true,
      approved_by: true,
      questions: {
        select: {
          id: true,
          type: true,
          prompt: true,
          position: true,
          points: true,
        },
        orderBy: { position: "asc" },
      },
    },
  });
  if (!test || test.section !== "Listening") notFound();
  const content = parseListeningContent(test.body_json);
  if (!content) notFound();

  const trackLabel =
    test.track === "Academic" ? "Academic" : "General Training";
  const synthStatus = summariseSynthStatus(content);

  return (
    <section className="px-6 py-10 md:py-12">
      <div className="mx-auto max-w-5xl space-y-8">
        <nav>
          <Link
            href="/content/listening"
            className="font-body text-sm text-brand-grey-700 hover:text-brand-red"
          >
            ← Back to Listening queue
          </Link>
        </nav>

        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Listening · {trackLabel} · difficulty {test.difficulty}
          </p>
          <h1 className="mt-2 font-display italic font-bold text-3xl md:text-4xl text-brand-black leading-tight">
            Review this section.
          </h1>
          <p className="mt-2 font-body text-sm text-brand-grey-600">
            Test id <code>{test.id}</code> · status{" "}
            <code>{test.status}</code> · created{" "}
            {test.createdAt.toISOString().slice(0, 10)}
          </p>
        </header>

        {sp.approved ? (
          <Banner tone="success">
            Approved. Learners on the {trackLabel} track can now see this
            section in /practice/listening.
          </Banner>
        ) : null}
        {sp.synth_ok ? (
          <Banner tone="success">
            Synthesis run completed: <code>{sp.synth_ok}</code> segments
            processed without failure.
          </Banner>
        ) : null}
        {sp.synth_error ? (
          <Banner tone="error">
            <span className="block">
              Synthesis run reported failures:{" "}
              <code>{sp.synth_error}</code>. Re-run from the form below;
              failed segments will be re-attempted.
            </span>
            {sp.synth_hint
              ? sp.synth_hint.split(" || ").map((line, i) => (
                  <span
                    key={i}
                    className="mt-2 block font-mono text-xs leading-snug break-all"
                  >
                    {line}
                  </span>
                ))
              : null}
          </Banner>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Stat label="Parts" value={String(content.parts.length)} />
          <Stat label="Questions" value={String(test.questions.length)} />
          <Stat
            label="Speakers"
            value={String(
              new Set(
                content.parts.flatMap((p) => p.speakers.map((s) => s.id)),
              ).size,
            )}
          />
          <Stat
            label="Audio clips"
            value={`${synthStatus.synthed} / ${synthStatus.total}`}
            sub={
              synthStatus.synthed === synthStatus.total
                ? "Fully synthed"
                : "Some missing"
            }
          />
        </div>

        {test.status === "PendingReview" ? (
          <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-5">
            <p className="font-heading font-bold text-base text-brand-black">
              Decide
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <form action={approveListeningTest}>
                <input type="hidden" name="testId" value={test.id} />
                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-pill bg-brand-red px-5 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
                >
                  Approve & synthesise audio
                </button>
                <p className="mt-2 font-body text-xs text-brand-grey-500">
                  Runs TTS for every speech / narration segment (~30 ElevenLabs
                  calls). 20–40 second wait.
                </p>
              </form>
              <form action={rejectListeningTest} className="space-y-2">
                <input type="hidden" name="testId" value={test.id} />
                <textarea
                  name="reason"
                  rows={2}
                  placeholder="Optional rejection note (e.g. transcript references US-only cultural detail)"
                  className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                />
                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-pill bg-brand-black px-5 py-3 font-heading font-bold text-white transition-colors hover:bg-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
                >
                  Reject
                </button>
              </form>
            </div>
          </div>
        ) : test.status === "Approved" && synthStatus.synthed < synthStatus.total ? (
          <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-3">
            <p className="font-heading font-bold text-base text-brand-black">
              Some audio clips are still missing.
            </p>
            <p className="font-body text-sm text-brand-grey-700">
              The approval flow had {synthStatus.total - synthStatus.synthed}{" "}
              failed synth job{synthStatus.total - synthStatus.synthed === 1 ? "" : "s"}.
              Re-running only re-attempts the failed segments.
            </p>
            <form action={resynthesiseListeningAudio}>
              <input type="hidden" name="testId" value={test.id} />
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
              >
                Re-synthesise missing clips
              </button>
            </form>
          </div>
        ) : null}

        {content.parts.map((part) => (
          <PartReview
            key={part.part}
            part={part}
            questions={test.questions.filter((q) =>
              part.question_positions.includes(q.position),
            )}
          />
        ))}
      </div>
    </section>
  );
}

function summariseSynthStatus(
  content: ListeningContent,
): { synthed: number; total: number } {
  let synthed = 0;
  let total = 0;
  for (const part of content.parts) {
    for (const seg of part.transcript) {
      if (seg.kind === "speech" || seg.kind === "narration") {
        total += 1;
        if (seg.audio_clip) synthed += 1;
      }
    }
  }
  return { synthed, total };
}

function PartReview({
  part,
  questions,
}: {
  part: ListeningPart;
  questions: {
    id: string;
    type: string;
    prompt: string;
    position: number;
    points: number;
  }[];
}) {
  return (
    <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-4">
      <header>
        <p className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
          Part {part.part} · {part.context}
        </p>
        <h2 className="mt-1 font-heading font-bold text-xl text-brand-black">
          {part.title}
        </h2>
        <p className="mt-1 font-body text-xs text-brand-grey-500">
          Speakers:{" "}
          {part.speakers
            .map((s) => `${s.name} (${s.accent}, ${s.role})`)
            .join(", ")}
        </p>
      </header>

      <details>
        <summary className="cursor-pointer font-heading font-bold text-sm text-brand-black select-none">
          Transcript
        </summary>
        <div className="mt-3 space-y-2">
          {part.transcript.map((seg, i) => (
            <p
              key={i}
              className="font-body text-sm text-brand-grey-900 leading-relaxed"
            >
              {seg.kind === "narration" ? (
                <>
                  <span className="font-heading font-bold text-brand-grey-600 mr-2">
                    [Narrator]
                  </span>
                  {seg.text}
                  {seg.audio_clip ? (
                    <span className="ml-2 font-body text-xs text-brand-grey-500">
                      ▶ synthed
                    </span>
                  ) : (
                    <span className="ml-2 font-body text-xs text-brand-red">
                      ! no audio
                    </span>
                  )}
                </>
              ) : seg.kind === "speech" ? (
                <>
                  <span className="font-heading font-bold text-brand-red mr-2">
                    [{seg.speaker_id}]
                  </span>
                  {seg.text}
                  {seg.audio_clip ? (
                    <span className="ml-2 font-body text-xs text-brand-grey-500">
                      ▶ synthed
                    </span>
                  ) : (
                    <span className="ml-2 font-body text-xs text-brand-red">
                      ! no audio
                    </span>
                  )}
                </>
              ) : seg.kind === "reading-pause" ? (
                <span className="italic text-brand-grey-500">
                  [pause {seg.seconds}s
                  {seg.instruction ? ` — ${seg.instruction}` : ""}]
                </span>
              ) : (
                <span className="italic text-brand-grey-500">
                  [preview Qs{" "}
                  {seg.question_positions.map((p) => p + 1).join(", ")} —{" "}
                  {seg.seconds}s]
                </span>
              )}
            </p>
          ))}
        </div>
      </details>

      <details>
        <summary className="cursor-pointer font-heading font-bold text-sm text-brand-black select-none">
          {questions.length} question{questions.length === 1 ? "" : "s"}
        </summary>
        <ol className="mt-3 space-y-1">
          {questions.map((q) => (
            <li
              key={q.id}
              className="font-body text-sm text-brand-grey-900"
            >
              <span className="font-heading font-bold text-brand-red mr-2">
                {q.position + 1}.
              </span>
              <span className="font-body text-xs text-brand-grey-500 mr-2">
                [{q.type} · {q.points}pt]
              </span>
              {q.prompt}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-5">
      <p className="font-body text-xs uppercase tracking-wide text-brand-grey-500">
        {label}
      </p>
      <p className="mt-1 font-display italic font-bold text-3xl text-brand-black leading-none">
        {value}
      </p>
      {sub ? (
        <p className="mt-1 font-body text-xs text-brand-grey-600">{sub}</p>
      ) : null}
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "success" | "warn" | "error";
  children: React.ReactNode;
}) {
  const styles =
    tone === "error"
      ? "bg-brand-red-soft ring-brand-red/40 text-brand-grey-900"
      : tone === "warn"
        ? "bg-brand-grey-50 ring-brand-grey-300 text-brand-grey-900"
        : "bg-brand-white ring-brand-grey-200 text-brand-grey-900";
  return (
    <div className={`rounded-lg ring-1 px-5 py-3 ${styles}`}>
      <p className="font-body text-sm">{children}</p>
    </div>
  );
}
