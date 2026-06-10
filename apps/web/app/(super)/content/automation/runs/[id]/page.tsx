import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withSuperAdminContext } from "@elc/db";
import { requireRole } from "@/lib/auth/context";

export const metadata: Metadata = {
  title: "Automation run · SuperAdmin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const SECTION_PATHS: Record<string, string> = {
  Reading: "reading",
  Listening: "listening",
  Writing: "writing",
  Speaking: "speaking",
};

// Shape written by the runner (AttemptVerdict[] serialised to Json).
type StoredVerdict = {
  attempt?: number;
  verdict?: string;
  issues?: { severity?: string; category?: string; detail?: string }[];
  feedback_for_regeneration?: string | null;
  reviewer_model?: string;
};

function parseVerdicts(raw: unknown): StoredVerdict[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is StoredVerdict => typeof v === "object" && v !== null);
}

function outcomeClasses(outcome: string): string {
  if (outcome === "Published") return "bg-brand-black text-white";
  if (outcome === "PendingHumanReview") return "bg-brand-grey-500 text-white";
  return "bg-brand-red text-white";
}

function outcomeLabel(outcome: string): string {
  if (outcome === "PendingHumanReview") return "Pending human review";
  return outcome;
}

function formatUtc(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export default async function AutomationRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);
  const { id } = await params;

  const run = await db.generationRun.findUnique({
    where: { id },
    include: {
      schedule: { select: { id: true, topic_hint: true, timezone: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          test: { select: { id: true, status: true, section: true } },
        },
      },
    },
  });
  if (!run) notFound();

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-5xl space-y-8">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            <Link
              href="/content/automation"
              className="hover:underline underline-offset-4"
            >
              ← Content automation
            </Link>
          </p>
          <h1 className="mt-2 font-display italic font-bold text-3xl md:text-4xl text-brand-black leading-tight">
            Run · {run.section} · {run.track === "GeneralTraining" ? "General Training" : run.track} · L{run.difficulty}
          </h1>
          <p className="mt-3 font-body text-sm text-brand-grey-700">
            {run.trigger} · started {formatUtc(run.started_at)}
            {run.finished_at ? ` · finished ${formatUtc(run.finished_at)}` : " · still running"}
            {" · "}auto-publish {run.auto_publish ? "on" : "off"} · requested ×
            {run.requested_count}
          </p>
          <p className="mt-1 font-body text-sm text-brand-grey-700">
            Outcome: <strong>{run.status}</strong> — {run.published_count}{" "}
            published, {run.pending_count} pending human review,{" "}
            {run.failed_count} failed.
          </p>
          {run.error ? (
            <p className="mt-2 font-body text-sm text-brand-red-dark">
              Run error: {run.error}
            </p>
          ) : null}
        </header>

        {run.items.length === 0 ? (
          <p className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 px-6 py-8 font-body text-base text-brand-grey-700">
            No items were attempted in this run.
          </p>
        ) : (
          <ol className="space-y-6">
            {run.items.map((item, idx) => {
              const verdicts = parseVerdicts(item.verdicts);
              const sectionPath = SECTION_PATHS[run.section] ?? "reading";
              return (
                <li
                  key={item.id}
                  className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-heading font-bold text-base text-brand-black">
                      Slot {idx + 1} · {item.attempts} generation
                      {item.attempts === 1 ? "" : "s"}
                    </h2>
                    <span
                      className={`inline-flex items-center rounded-pill px-3 py-1 font-heading font-bold text-xs ${outcomeClasses(item.outcome)}`}
                    >
                      {outcomeLabel(item.outcome)}
                    </span>
                  </div>

                  {item.test_id ? (
                    <p className="mt-2 font-body text-sm text-brand-grey-700">
                      Test{" "}
                      <Link
                        href={`/content/${sectionPath}/${item.test_id}`}
                        className="text-brand-black underline underline-offset-4 hover:text-brand-red-dark"
                      >
                        {item.test_id}
                      </Link>{" "}
                      — current status {item.test?.status ?? "(deleted)"}
                    </p>
                  ) : (
                    <p className="mt-2 font-body text-sm text-brand-grey-500">
                      No test was persisted for this slot.
                    </p>
                  )}
                  {item.error ? (
                    <p className="mt-2 font-body text-sm text-brand-red-dark">
                      {item.error}
                    </p>
                  ) : null}

                  {verdicts.length > 0 ? (
                    <div className="mt-4 space-y-3">
                      {verdicts.map((v, vi) => (
                        <div
                          key={vi}
                          className="rounded-md bg-brand-grey-50 ring-1 ring-brand-grey-200 p-4"
                        >
                          <p className="font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600">
                            Attempt {v.attempt ?? vi + 1} ·{" "}
                            <span
                              className={
                                v.verdict === "approve"
                                  ? "text-brand-black"
                                  : "text-brand-red-dark"
                              }
                            >
                              {v.verdict ?? "?"}
                            </span>
                            {v.reviewer_model ? ` · ${v.reviewer_model}` : ""}
                          </p>
                          {v.issues && v.issues.length > 0 ? (
                            <ul className="mt-2 space-y-1">
                              {v.issues.map((issue, ii) => (
                                <li
                                  key={ii}
                                  className="font-body text-sm text-brand-grey-700"
                                >
                                  <span
                                    className={`font-heading font-bold text-xs ${
                                      issue.severity === "critical"
                                        ? "text-brand-red-dark"
                                        : "text-brand-grey-500"
                                    }`}
                                  >
                                    [{issue.severity ?? "?"}] {issue.category ?? ""}
                                  </span>{" "}
                                  {issue.detail ?? ""}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 font-body text-sm text-brand-grey-500">
                              No issues raised.
                            </p>
                          )}
                          {v.feedback_for_regeneration ? (
                            <p className="mt-2 font-body text-sm text-brand-grey-700">
                              <span className="font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600">
                                Feedback to generator:{" "}
                              </span>
                              {v.feedback_for_regeneration}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 font-body text-sm text-brand-grey-500">
                      No reviewer verdicts recorded.
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
