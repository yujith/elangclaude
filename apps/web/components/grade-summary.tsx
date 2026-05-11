// Minimal grade display used by /results/[attemptId]. Phase 3 baseline —
// Phase 4 replaces this with a richer hero card + evidence interactions
// + sample-answer reveal.

import Link from "next/link";
import type { WritingGrade } from "@elc/ai";

type Props = {
  taskTypeLabel: string;
  grade: WritingGrade;
};

const CRITERION_LABELS: Record<keyof WritingGrade["criteria"], string> = {
  task_achievement: "Task Achievement / Response",
  coherence_cohesion: "Coherence & Cohesion",
  lexical_resource: "Lexical Resource",
  grammatical_range: "Grammatical Range & Accuracy",
};

function bandLabel(n: number): string {
  return Number.isInteger(n) ? `${n.toFixed(1)}` : n.toFixed(1);
}

export function GradeSummary({ taskTypeLabel, grade }: Props) {
  return (
    <div className="space-y-8">
      {/* Hero: overall band on black */}
      <section className="rounded-lg bg-brand-black text-white p-8 md:p-12 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div>
          <p className="font-body text-sm uppercase tracking-widest text-brand-grey-200">
            {taskTypeLabel}
          </p>
          <p className="font-heading font-bold text-xl mt-1">Overall band</p>
        </div>
        <p className="font-display italic font-bold text-7xl md:text-8xl leading-none text-brand-red tabular-nums">
          {bandLabel(grade.band_overall)}
        </p>
      </section>

      {/* Criterion rows */}
      <section className="space-y-4">
        <h2 className="font-heading font-bold text-2xl text-brand-black">
          Criterion breakdown
        </h2>
        <ul className="space-y-3">
          {(Object.keys(CRITERION_LABELS) as (keyof WritingGrade["criteria"])[]).map(
            (key) => {
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
            },
          )}
        </ul>
      </section>

      {/* Strengths + Improvements */}
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

      <div className="flex justify-center pt-2">
        <Link
          href="/practice/writing"
          className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
        >
          Practice another task
        </Link>
      </div>
    </div>
  );
}
