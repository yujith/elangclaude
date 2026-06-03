import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { withOrg } from "@elc/db";
import { bandFromPartial, parseReadingGrade } from "@elc/ai";
import { requireOrgContext } from "@/lib/auth/context";
import {
  finalizePaperSession,
  readPaperSessionState,
} from "@/lib/reading/paper-session";

export const metadata: Metadata = {
  title: "Full Reading paper — result",
};

export const dynamic = "force-dynamic";

type Params = { sessionId: string };

function bandLabel(band: number): string {
  return band.toFixed(1);
}

export default async function ReadingPaperResultPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { sessionId } = await params;
  const ctx = await requireOrgContext();
  const state = await readPaperSessionState(ctx, sessionId);
  if (!state.ok) notFound();

  // If the learner reached the result URL before finishing every part,
  // send them back to the orchestrator to continue.
  if (!state.allGraded) {
    redirect(`/practice/reading/paper/${sessionId}`);
  }

  // Mark the sitting complete (idempotent).
  await finalizePaperSession(ctx, sessionId);

  // Pull each part's grade payload for the raw counts. Attempt is
  // tenant-scoped; withOrg auto-filters by org_id.
  const db = withOrg(ctx);
  const attemptIds = state.parts
    .map((p) => p.attemptId)
    .filter((id): id is string => Boolean(id));
  const attempts = await db.attempt.findMany({
    where: { id: { in: attemptIds } },
    select: {
      id: true,
      grade: { select: { criteria_scores_json: true } },
    },
  });
  const gradeByAttempt = new Map(attempts.map((a) => [a.id, a.grade]));

  const partRows = state.parts.map((p) => {
    const grade = p.attemptId
      ? parseReadingGrade(gradeByAttempt.get(p.attemptId)?.criteria_scores_json)
      : null;
    return {
      slot: p.slot,
      title: p.title,
      attemptId: p.attemptId,
      correct: grade?.raw_correct ?? 0,
      total: grade?.raw_total ?? 0,
      band: grade?.band_overall ?? null,
    };
  });

  const sumCorrect = partRows.reduce((acc, r) => acc + r.correct, 0);
  const sumTotal = partRows.reduce((acc, r) => acc + r.total, 0);

  // Combined band off the true 40-question curve (scaled from the paper's
  // actual question count — typically ~39 across three passages).
  const overallBand = bandFromPartial(state.track, sumCorrect, sumTotal);
  const trackLabel = state.track === "Academic" ? "Academic" : "General Training";

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            {trackLabel} · Full Reading paper
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Your reading band.
          </h1>
        </header>

        <div className="rounded-lg bg-brand-black text-white p-8 flex items-center justify-between gap-6">
          <div>
            <p className="font-body text-sm uppercase tracking-widest text-white/70">
              Approximate band
            </p>
            <p className="mt-1 font-display italic font-bold text-6xl leading-none">
              {bandLabel(overallBand)}
            </p>
          </div>
          <div className="text-right">
            <p className="font-heading font-bold text-3xl">
              {sumCorrect}
              <span className="text-white/60">/{sumTotal}</span>
            </p>
            <p className="font-body text-sm text-white/70">correct</p>
          </div>
        </div>

        <p className="font-body text-sm text-brand-grey-600">
          Band is an approximation off the published 40-question conversion,
          scaled to this paper&apos;s {sumTotal} questions. It calibrates your
          level — it is not an examiner-equivalent score.
        </p>

        <section className="space-y-3">
          <h2 className="font-heading font-bold text-xl text-brand-black">
            By passage
          </h2>
          <ul className="space-y-3">
            {partRows.map((r) => (
              <li
                key={r.slot}
                className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-5 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="font-heading font-bold text-brand-black">
                    Part {r.slot}
                    {r.title ? (
                      <span className="ml-2 font-body font-normal text-sm text-brand-grey-600">
                        {r.title}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 font-body text-sm text-brand-grey-600">
                    {r.correct}/{r.total} correct
                    {r.band !== null ? ` · part band ≈ ${bandLabel(r.band)}` : ""}
                  </p>
                </div>
                {r.attemptId ? (
                  <Link
                    href={`/results/${r.attemptId}`}
                    className="shrink-0 font-heading font-bold text-sm text-brand-red hover:underline"
                  >
                    Review answers
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/practice/reading?mode=mock"
            className="inline-flex items-center rounded-pill bg-brand-red px-5 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark"
          >
            Take another paper
          </Link>
          <Link
            href="/practice/reading"
            className="inline-flex items-center rounded-pill px-5 py-3 font-heading font-bold text-brand-grey-700 ring-1 ring-brand-grey-300 transition-colors hover:text-brand-black"
          >
            Back to Reading
          </Link>
        </div>
      </div>
    </section>
  );
}
