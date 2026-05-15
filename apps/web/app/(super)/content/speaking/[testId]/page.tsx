import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withSuperAdminContext } from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import { parseSpeakingContent, renderCueCard } from "@/lib/speaking/content";
import {
  approveSpeakingTest,
  rejectSpeakingTest,
} from "@/lib/speaking/moderation-actions";

export const metadata: Metadata = {
  title: "Review Speaking test",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Params = { testId: string };
type SearchParams = { approved?: string };

export default async function ReviewSpeakingTestPage({
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
    },
  });
  if (!test || test.section !== "Speaking") notFound();

  const content = parseSpeakingContent(test.body_json);
  const trackLabel =
    test.track === "Academic" ? "Academic" : "General Training";
  const status = test.status;

  return (
    <section className="px-6 py-10 md:py-12">
      <div className="mx-auto max-w-4xl space-y-8">
        <nav>
          <Link
            href="/content/speaking"
            className="font-body text-sm text-brand-grey-700 hover:text-brand-red"
          >
            ← Back to queue
          </Link>
        </nav>

        <header className="space-y-2">
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Review · Speaking · {trackLabel} · difficulty {test.difficulty}
          </p>
          <h1 className="font-display italic font-bold text-3xl md:text-4xl text-brand-black leading-tight">
            {content ? content.topic_domain : "Speaking test"}.
          </h1>
          <p className="font-body text-sm text-brand-grey-700">
            Status <code>{status}</code> · generated{" "}
            {test.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC ·
            test id <code>{test.id}</code>
          </p>
        </header>

        {sp.approved ? (
          <Banner tone="success">
            This test is already approved. It is now visible to learners on
            the Speaking picker.
          </Banner>
        ) : null}

        {!content ? (
          <Banner tone="error">
            This test&apos;s content failed to parse — the stored script is
            malformed. Reject it; the generator can produce a fresh one.
          </Banner>
        ) : (
          <>
            <article className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-4">
              <div>
                <h2 className="font-heading font-bold text-xl text-brand-black">
                  Part 1 — Interview
                </h2>
                <p className="font-body text-sm text-brand-grey-600">
                  {content.part1.theme}
                </p>
              </div>
              <div className="space-y-4">
                {content.part1.subtopics.map((sub) => (
                  <div key={sub.topic}>
                    <h3 className="font-heading font-bold text-sm uppercase tracking-wide text-brand-grey-600 mb-1">
                      {sub.topic}
                    </h3>
                    <ul className="list-disc pl-5 space-y-1">
                      {sub.questions.map((q, i) => (
                        <li
                          key={i}
                          className="font-body text-base text-brand-grey-900 leading-relaxed"
                        >
                          {q}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-4">
              <h2 className="font-heading font-bold text-xl text-brand-black">
                Part 2 — Long turn (cue card)
              </h2>
              <pre className="font-body text-base text-brand-grey-900 leading-relaxed whitespace-pre-wrap bg-brand-grey-50 rounded-md ring-1 ring-brand-grey-200 p-4">
                {renderCueCard(content.part2)}
              </pre>
              <div>
                <h3 className="font-heading font-bold text-sm uppercase tracking-wide text-brand-grey-600 mb-1">
                  Rounding-off questions
                </h3>
                <ul className="list-disc pl-5 space-y-1">
                  {content.part2.followup_questions.map((q, i) => (
                    <li
                      key={i}
                      className="font-body text-base text-brand-grey-900 leading-relaxed"
                    >
                      {q}
                    </li>
                  ))}
                </ul>
              </div>
            </article>

            <article className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-3">
              <div>
                <h2 className="font-heading font-bold text-xl text-brand-black">
                  Part 3 — Discussion
                </h2>
                <p className="font-body text-sm text-brand-grey-600">
                  {content.part3.theme}
                </p>
              </div>
              <ul className="list-disc pl-5 space-y-1">
                {content.part3.questions.map((q, i) => (
                  <li
                    key={i}
                    className="font-body text-base text-brand-grey-900 leading-relaxed"
                  >
                    {q}
                  </li>
                ))}
              </ul>
            </article>
          </>
        )}

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
          <h2 className="font-heading font-bold text-xl text-brand-black mb-4">
            Decide
          </h2>
          {status !== "PendingReview" ? (
            <p className="font-body text-sm text-brand-grey-700">
              This test is already <code>{status}</code>. No action needed.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3 items-start">
              <form action={approveSpeakingTest}>
                <input type="hidden" name="testId" value={test.id} />
                <button
                  type="submit"
                  disabled={!content}
                  className="inline-flex items-center rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Approve — release to learners
                </button>
              </form>
              <form
                action={rejectSpeakingTest}
                className="flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="testId" value={test.id} />
                <div>
                  <label
                    htmlFor="reason"
                    className="block font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-1"
                  >
                    Reject reason (optional)
                  </label>
                  <input
                    id="reason"
                    name="reason"
                    type="text"
                    maxLength={500}
                    placeholder="e.g. Part 3 not abstract enough"
                    className="w-72 rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex items-center rounded-pill bg-brand-black px-6 py-3 font-heading font-bold text-white transition-colors hover:bg-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
                >
                  Reject
                </button>
              </form>
            </div>
          )}
        </section>
      </div>
    </section>
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
