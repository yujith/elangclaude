import type { Metadata } from "next";
import Link from "next/link";
import { withSuperAdminContext } from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import { parseSpeakingContent } from "@/lib/speaking/content";
import { generateSpeakingTestForm } from "@/lib/speaking/generate-actions";

export const metadata: Metadata = {
  title: "Speaking content moderation",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = {
  approved?: string;
  rejected?: string;
  generated?: string;
  generate_error?: string;
  validation_issues?: string;
};

const PAGE_SIZE = 25;

function difficultyDots(level: number): string {
  const filled = Math.max(1, Math.min(5, level));
  return "●".repeat(filled) + "○".repeat(5 - filled);
}

export default async function SpeakingModerationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);
  const sp = await searchParams;

  const [pending, approvedCount, rejectedCount] = await Promise.all([
    db.test.findMany({
      where: { section: "Speaking", status: "PendingReview" },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      select: {
        id: true,
        track: true,
        difficulty: true,
        createdAt: true,
        generated_model: true,
        body_json: true,
      },
    }),
    db.test.count({ where: { section: "Speaking", status: "Approved" } }),
    db.test.count({ where: { section: "Speaking", status: "Rejected" } }),
  ]);

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl space-y-10">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Content moderation
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Speaking queue.
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
            Newly generated Speaking tests land here as{" "}
            <code>PendingReview</code>. Each is a full 3-part examiner script.
            Review a test to approve or reject it. Approved tests reach
            learners on the Speaking practice picker.
          </p>
        </header>

        {sp.approved ? (
          <Banner tone="success">
            Approved test <code>{sp.approved}</code> — it should now appear in
            the learner Speaking picker.
          </Banner>
        ) : null}
        {sp.rejected ? (
          <Banner tone="warn">
            Rejected test <code>{sp.rejected}</code>. It will not reach
            learners.
          </Banner>
        ) : null}
        {sp.generated ? (
          <Banner tone="success">
            Generated test <code>{sp.generated}</code> — review it below
            before approving.
          </Banner>
        ) : null}
        {sp.generate_error ? (
          <Banner tone="error">
            Generation failed: <code>{sp.generate_error}</code>
            {sp.validation_issues ? ` (${sp.validation_issues})` : ""}. Server
            console has the full issue array.
          </Banner>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Stat label="Pending review" value={pending.length} />
          <Stat label="Approved" value={approvedCount} />
          <Stat label="Rejected" value={rejectedCount} />
        </div>

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
          <h2 className="font-heading font-bold text-lg text-brand-black mb-3">
            Generate a new test
          </h2>
          <form
            action={generateSpeakingTestForm}
            className="flex flex-wrap items-end gap-4"
          >
            <div>
              <label
                htmlFor="track"
                className="block font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-1"
              >
                Track
              </label>
              <select
                id="track"
                name="track"
                defaultValue="Academic"
                className="rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              >
                <option value="Academic">Academic</option>
                <option value="GeneralTraining">General Training</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="difficulty"
                className="block font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-1"
              >
                Difficulty
              </label>
              <input
                id="difficulty"
                name="difficulty"
                type="number"
                min={1}
                max={5}
                defaultValue={3}
                className="w-20 rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              />
            </div>
            <div className="flex-1 min-w-[16rem]">
              <label
                htmlFor="topicHint"
                className="block font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-1"
              >
                Topic hint (optional)
              </label>
              <input
                id="topicHint"
                name="topicHint"
                type="text"
                placeholder="e.g. neighbourhoods and community"
                className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              Generate
            </button>
          </form>
          <p className="mt-3 font-body text-xs text-brand-grey-500">
            IELTS Speaking content is identical across tracks — the track is a
            catalog tag only.
          </p>
        </section>

        <section>
          <h2 className="font-heading font-bold text-xl text-brand-black mb-4">
            Pending review ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <div className="rounded-lg bg-brand-white p-6 ring-1 ring-brand-grey-200">
              <p className="font-body text-base text-brand-grey-700">
                Nothing pending — the queue is empty. Generate a new test
                above.
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {pending.map((t) => {
                const content = parseSpeakingContent(t.body_json);
                const trackLabel =
                  t.track === "Academic" ? "Academic" : "General Training";
                return (
                  <li
                    key={t.id}
                    className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 flex flex-col gap-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center rounded-pill bg-brand-black text-white font-heading font-bold text-xs px-3 py-1">
                        Speaking · 3 parts
                      </span>
                      <span
                        className="font-body text-xs text-brand-grey-500"
                        aria-label={`Difficulty ${t.difficulty} of 5`}
                        title={`Difficulty ${t.difficulty} of 5`}
                      >
                        {difficultyDots(t.difficulty)}
                      </span>
                    </div>
                    {content ? (
                      <div className="space-y-1">
                        <p className="font-heading font-bold text-base text-brand-black">
                          {content.part2.cue_card_topic}
                        </p>
                        <p className="font-body text-sm text-brand-grey-700">
                          Domain: {content.topic_domain} · Part 1:{" "}
                          {content.part1.theme} · Part 3: {content.part3.theme}
                        </p>
                      </div>
                    ) : (
                      <p className="font-body text-sm text-brand-red">
                        Content failed to parse — reject this test.
                      </p>
                    )}
                    <dl className="grid grid-cols-2 gap-3 text-sm font-body text-brand-grey-700">
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-brand-grey-500">
                          Track
                        </dt>
                        <dd className="font-heading font-bold text-brand-black">
                          {trackLabel}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-brand-grey-500">
                          Generated
                        </dt>
                        <dd className="font-heading font-bold text-brand-black">
                          {t.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-brand-grey-500">
                          Model
                        </dt>
                        <dd className="font-heading font-bold text-brand-black break-all">
                          {t.generated_model ?? "—"}
                        </dd>
                      </div>
                    </dl>
                    <Link
                      href={`/content/speaking/${t.id}`}
                      className="mt-auto w-full inline-flex items-center justify-center gap-2 rounded-pill bg-brand-red px-5 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
                    >
                      Review
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-5">
      <p className="font-body text-xs uppercase tracking-wide text-brand-grey-500">
        {label}
      </p>
      <p className="mt-1 font-display italic font-bold text-3xl text-brand-black leading-none">
        {value}
      </p>
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
