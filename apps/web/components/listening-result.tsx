import Link from "next/link";
import type { ListeningGrade } from "@elc/ai";

type Props = {
  grade: ListeningGrade;
};

export function ListeningResult({ grade }: Props) {
  const pct =
    grade.raw_total > 0
      ? Math.round((grade.raw_correct / grade.raw_total) * 100)
      : 0;
  return (
    <section className="bg-brand-grey-50 px-6 py-12 md:py-16">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Listening · result
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Here&apos;s how that section went.
          </h1>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Stat
            label="Raw score"
            big={`${grade.raw_correct} / ${grade.raw_total}`}
            sub={`${pct}% correct (partial credit on multi-MCQ counted)`}
          />
          <Stat
            label="Band (approx.)"
            big={grade.band_overall.toFixed(1)}
            sub="IELTS Listening conversion"
          />
          <Stat
            label="Section"
            big="Listening"
            sub="Deterministic grading — no AI"
          />
        </div>

        <p className="font-body text-sm text-brand-grey-600 mb-6">
          A practice section is shorter than the official 40-question exam.
          The band above scales your raw score to the 40-question equivalent
          and looks it up against the published IELTS Listening conversion
          table — treat it as a calibration cue, not an examiner-equivalent
          mark.
        </p>

        <ol className="space-y-4">
          {grade.breakdown.map((b) => {
            const partial =
              b.points_earned > 0 && b.points_earned < b.points_possible;
            return (
              <li
                key={b.question_id}
                className={
                  "rounded-lg ring-1 p-5 bg-brand-white " +
                  (b.is_correct
                    ? "ring-brand-grey-200"
                    : partial
                      ? "ring-brand-grey-300 bg-brand-grey-50"
                      : "ring-brand-red/40 bg-brand-red-soft/40")
                }
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="font-heading font-bold text-sm text-brand-black">
                    Question {b.position + 1}
                  </span>
                  <span
                    className={
                      "inline-flex items-center rounded-pill font-heading font-bold text-xs px-3 py-1 " +
                      (b.is_correct
                        ? "bg-brand-black text-white"
                        : partial
                          ? "bg-brand-grey-700 text-white"
                          : "bg-brand-red text-white")
                    }
                  >
                    {b.is_correct
                      ? `Correct (${b.points_earned}/${b.points_possible})`
                      : partial
                        ? `Partial (${b.points_earned}/${b.points_possible})`
                        : `Incorrect (0/${b.points_possible})`}
                  </span>
                </div>
                {b.prompt ? (
                  <p className="font-body text-sm text-brand-grey-900 mb-3 whitespace-pre-wrap">
                    {b.prompt}
                  </p>
                ) : null}
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm font-body">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-brand-grey-500">
                      Your answer
                    </dt>
                    <dd className="font-heading font-bold text-brand-black break-words">
                      {b.learner_summary}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-brand-grey-500">
                      Accepted answer
                    </dt>
                    <dd className="font-heading font-bold text-brand-black break-words">
                      {b.correct_summary}
                    </dd>
                  </div>
                </dl>
                {!b.is_correct ? (
                  <p className="mt-2 font-body text-sm text-brand-grey-700">
                    {b.reason}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/practice/listening"
            className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
          >
            Try another section
          </Link>
          <Link
            href="/practice/reading"
            className="inline-flex items-center gap-2 rounded-pill bg-brand-black px-5 py-2.5 font-heading font-bold text-white transition-colors hover:bg-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
          >
            Switch to Reading
          </Link>
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  big,
  sub,
}: {
  label: string;
  big: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-5">
      <p className="font-body text-xs uppercase tracking-wide text-brand-grey-500">
        {label}
      </p>
      <p className="mt-1 font-display italic font-bold text-3xl text-brand-black leading-none">
        {big}
      </p>
      <p className="mt-2 font-body text-xs text-brand-grey-600">{sub}</p>
    </div>
  );
}
