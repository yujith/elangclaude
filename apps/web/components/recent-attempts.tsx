import Link from "next/link";
import type { RecentAttempt, Section } from "@elc/db";
import { formatRelativeTime } from "@/lib/format/relative-time";

const SECTION_PATH: Record<Section, string> = {
  Reading: "/practice/reading",
  Listening: "/practice/listening",
  Writing: "/practice/writing",
  Speaking: "/practice/speaking",
};

function hrefFor(a: RecentAttempt): string {
  if (a.status === "InProgress") return `${SECTION_PATH[a.section]}/${a.id}`;
  // Graded + Submitted both land on /results/[id]; the result page shows
  // the band when it's there and a "still grading" message otherwise.
  return `/results/${a.id}`;
}

function bandLabel(a: RecentAttempt): React.ReactNode {
  if (a.status === "InProgress") {
    return (
      <span className="font-body text-sm text-brand-grey-700">in progress</span>
    );
  }
  if (a.status === "Submitted" || a.bandOverall === null) {
    return (
      <span className="font-body text-sm text-brand-grey-700">grading…</span>
    );
  }
  return (
    <span className="font-display italic font-bold text-xl text-brand-black leading-none">
      {a.bandOverall.toFixed(1)}
    </span>
  );
}

type Props = {
  recent: RecentAttempt[];
  now?: Date;
};

// Quiet list — no table chrome, no headers, no zebra. Each row is a
// link to either the section runner (InProgress) or the result page.
export function RecentAttempts({ recent, now }: Props) {
  if (recent.length === 0) {
    return (
      <p className="font-body text-sm text-brand-grey-700">
        No history yet. Your first attempt will appear here.
      </p>
    );
  }
  return (
    <ul className="list-none p-0 divide-y divide-brand-grey-100">
      {recent.map((a) => {
        const when = a.submittedAt ?? a.startedAt;
        return (
          <li key={a.id}>
            <Link
              href={hrefFor(a)}
              className="group grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-6 py-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              <span className="font-heading font-bold text-base text-brand-black">
                {a.section}
              </span>
              <span className="w-20 text-right">{bandLabel(a)}</span>
              <span className="w-32 text-right font-body text-sm text-brand-grey-700">
                {formatRelativeTime(when, now)}
              </span>
              <span
                aria-hidden="true"
                className="font-heading font-bold text-sm text-brand-red-dark group-hover:text-brand-black transition-colors"
              >
                →
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
