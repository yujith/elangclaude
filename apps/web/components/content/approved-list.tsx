import Link from "next/link";

// Compact per-section list of Approved tests with a "Manage" link into the
// section's review/lifecycle surface. The global /content "Approved" view is
// the cross-section equivalent with filters; this is the per-section
// drill-down rendered at the bottom of each /content/{section} page.

export type ApprovedRow = {
  id: string;
  track: "Academic" | "GeneralTraining";
  difficulty: number;
  body_json: unknown;
  createdAt: Date;
  generated_model: string | null;
  _count: { questions: number };
  // Present for sections whose row label comes from the first question prompt
  // (Writing / Speaking) rather than body_json (Reading / Listening).
  questions?: { prompt: string }[];
  // ADR-0024 audit affordance: non-empty when an automation run published
  // this test (GenerationRunItem outcome=Published). Callers select it
  // filtered + take 1; rows without it just omit the badge.
  run_items?: { id: string }[];
};

function difficultyDots(level: number): string {
  const filled = Math.max(1, Math.min(5, level));
  return "●".repeat(filled) + "○".repeat(5 - filled);
}

export function ApprovedList({
  rows,
  totalCount,
  pageSize,
  basePath,
  previewOf,
}: {
  rows: ApprovedRow[];
  totalCount: number;
  pageSize: number;
  basePath: string;
  /** One-line label for the row (passage title, first prompt, etc.). */
  previewOf: (t: ApprovedRow) => string;
}) {
  return (
    <section>
      <h2 className="font-heading font-bold text-xl text-brand-black mb-4">
        Approved ({totalCount})
      </h2>
      {rows.length === 0 ? (
        <div className="rounded-lg bg-brand-white p-6 ring-1 ring-brand-grey-200">
          <p className="font-body text-base text-brand-grey-700">
            No approved content yet.
          </p>
        </div>
      ) : (
        <ul className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 divide-y divide-brand-grey-200">
          {rows.map((t) => {
            const trackLabel =
              t.track === "Academic" ? "Academic" : "General Training";
            return (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="flex flex-wrap items-center gap-3 min-w-0">
                  <span className="inline-flex items-center rounded-pill bg-brand-black text-white font-heading font-bold text-xs px-3 py-1">
                    {trackLabel}
                  </span>
                  <span
                    className="font-body text-xs text-brand-grey-500"
                    aria-label={`Difficulty ${t.difficulty} of 5`}
                    title={`Difficulty ${t.difficulty} of 5`}
                  >
                    {difficultyDots(t.difficulty)}
                  </span>
                  {t.run_items && t.run_items.length > 0 ? (
                    <span
                      className="inline-flex items-center rounded-pill border border-brand-grey-300 bg-brand-grey-50 px-2.5 py-0.5 font-heading font-bold text-xs text-brand-grey-700"
                      title="Published by automation — reviewer-model approved, no human review"
                    >
                      Auto
                    </span>
                  ) : null}
                  <span className="font-body text-sm text-brand-grey-700 truncate max-w-xs">
                    {previewOf(t)}
                  </span>
                  <span className="font-body text-xs text-brand-grey-500">
                    {t._count.questions} Q ·{" "}
                    {t.createdAt.toISOString().slice(0, 10)}
                  </span>
                </div>
                <Link
                  href={`${basePath}/${t.id}`}
                  className="inline-flex items-center gap-2 rounded-pill bg-brand-white text-brand-red font-heading font-bold text-sm px-4 py-2 ring-1 ring-brand-red transition-colors hover:bg-brand-red hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
                >
                  Manage
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length === pageSize && totalCount > pageSize ? (
        <p className="mt-3 font-body text-xs text-brand-grey-500">
          Showing the {pageSize} most recent of {totalCount}. Use the global{" "}
          <Link href="/content?view=approved" className="underline">
            Approved view
          </Link>{" "}
          to filter across sections.
        </p>
      ) : null}
    </section>
  );
}
