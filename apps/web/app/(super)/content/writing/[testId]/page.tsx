import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withSuperAdminContext } from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import { isWritingTaskType, taskShortLabel } from "@/lib/writing/task";
import { parseVisual } from "@/lib/writing/visual";
import {
  parseWritingIssueCodes,
  readWritingBodyMeta,
  validateWritingReviewRecord,
} from "@/lib/writing/review-validation";
import { TaskVisual } from "@/components/task-visual";
import {
  approveWritingTest,
  editWritingPrompt,
  rejectWritingTest,
} from "@/lib/writing/moderation-actions";

export const metadata: Metadata = {
  title: "Review Writing task",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Params = { testId: string };
type SearchParams = {
  approved?: string;
  edited?: string;
  approve_error?: string;
  edit_error?: string;
  validation_issues?: string;
};

function formatIssueCodes(issueCodes: string[]): string {
  return issueCodes.join(", ");
}

export default async function ReviewWritingTaskPage({
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
      questions: {
        select: { id: true, type: true, prompt: true, visual: true },
        orderBy: { position: "asc" },
        take: 1,
      },
    },
  });
  if (!test || test.section !== "Writing") notFound();
  const question = test.questions[0];
  if (!question) notFound();

  const kindLabel = isWritingTaskType(question.type)
    ? taskShortLabel(question.type)
    : "Writing task";
  const trackLabel =
    test.track === "Academic" ? "Academic" : "General Training";
  const status = test.status;
  const visual = parseVisual(question.visual);
  const bodyMeta = readWritingBodyMeta(test.body_json);
  const issueCodes = parseWritingIssueCodes(sp.validation_issues);
  const reviewValidation = validateWritingReviewRecord({
    track: test.track,
    difficulty: test.difficulty,
    body_json: test.body_json,
    question,
  });
  const approvalBlocked = status === "PendingReview" && !reviewValidation.ok;
  const currentIssueCodes = reviewValidation.ok ? [] : reviewValidation.issueCodes;

  return (
    <section className="px-6 py-10 md:py-12">
      <div className="mx-auto max-w-4xl space-y-8">
        <nav>
          <Link
            href="/content/writing"
            className="font-body text-sm text-brand-grey-700 hover:text-brand-red"
          >
            ← Back to queue
          </Link>
        </nav>

        <header className="space-y-2">
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Review · {kindLabel} · {trackLabel} · difficulty {test.difficulty}
          </p>
          <h1 className="font-display italic font-bold text-3xl md:text-4xl text-brand-black leading-tight">
            {kindLabel}.
          </h1>
          <p className="font-body text-sm text-brand-grey-700">
            Status <code>{status}</code> · generated{" "}
            {test.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC ·
            test id <code>{test.id}</code>
          </p>
        </header>

        {sp.approved ? (
          <Banner tone="success">
            This task is already approved. It is now visible to {trackLabel}{" "}
            learners on the picker.
          </Banner>
        ) : null}
        {sp.edited ? (
          <Banner tone="success">
            Task prompt updated. The original text is recorded in the activity
            log.
          </Banner>
        ) : null}
        {sp.edit_error === "length" ? (
          <Banner tone="error">
            The edited prompt must be between 20 and 2400 characters. Your
            change was not saved.
          </Banner>
        ) : null}
        {sp.edit_error &&
        sp.edit_error !== "length" &&
        issueCodes.length > 0 ? (
          <Banner tone="error">
            The edited prompt was not saved because the task would no longer
            satisfy the Writing contract. Issue codes:{" "}
            <code>{formatIssueCodes(issueCodes)}</code>.
          </Banner>
        ) : null}
        {sp.approve_error && issueCodes.length > 0 ? (
          <Banner tone="error">
            Approval was blocked because this task does not currently satisfy
            the Writing contract. Issue codes:{" "}
            <code>{formatIssueCodes(issueCodes)}</code>.
          </Banner>
        ) : null}
        {approvalBlocked ? (
          <Banner tone="error">
            This task cannot be approved in its current state. Fix or reject
            it first. Issue codes:{" "}
            <code>{formatIssueCodes(currentIssueCodes)}</code>.
          </Banner>
        ) : null}

        {bodyMeta.length > 0 ? (
          <article className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
            <h2 className="font-heading font-bold text-lg text-brand-black mb-3">
              Task metadata
            </h2>
            <dl className="flex flex-wrap gap-x-8 gap-y-3">
              {bodyMeta.map((m) => (
                <div key={m.label}>
                  <dt className="font-body text-xs uppercase tracking-wide text-brand-grey-500">
                    {m.label}
                  </dt>
                  <dd className="font-heading font-bold text-sm text-brand-black">
                    {m.value}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ) : null}

        {visual ? (
          <article className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-4">
            <h2 className="font-heading font-bold text-xl text-brand-black">
              Visual as the learner will see it
            </h2>
            <TaskVisual visual={visual} />
          </article>
        ) : question.type === "writing-task-1-academic" ? (
          <Banner tone="error">
            This Academic Task 1 has no renderable visual — the chart spec
            failed to parse. Reject it.
          </Banner>
        ) : null}

        <article className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-4">
          <h2 className="font-heading font-bold text-xl text-brand-black">
            Task prompt as the learner will see it
          </h2>
          <p className="font-body text-base text-brand-grey-900 leading-relaxed whitespace-pre-wrap">
            {question.prompt}
          </p>
        </article>

        {status === "PendingReview" ? (
          <article className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-3">
            <h2 className="font-heading font-bold text-xl text-brand-black">
              Edit the prompt
            </h2>
            <p className="font-body text-sm text-brand-grey-700">
              Tweak the wording before approving. The original is kept in the
              activity log.
            </p>
            <form action={editWritingPrompt} className="space-y-3">
              <input type="hidden" name="testId" value={test.id} />
              <textarea
                name="prompt"
                rows={8}
                defaultValue={question.prompt}
                maxLength={2400}
                className="w-full rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              />
              <button
                type="submit"
                className="inline-flex items-center rounded-pill bg-brand-black px-5 py-2.5 font-heading font-bold text-white transition-colors hover:bg-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
              >
                Save prompt edit
              </button>
            </form>
          </article>
        ) : null}

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
          <h2 className="font-heading font-bold text-xl text-brand-black mb-4">
            Decide
          </h2>
          {status !== "PendingReview" ? (
            <p className="font-body text-sm text-brand-grey-700">
              This task is already <code>{status}</code>. No action needed.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3 items-start">
              <form action={approveWritingTest}>
                <input type="hidden" name="testId" value={test.id} />
                <button
                  type="submit"
                  disabled={approvalBlocked}
                  className="inline-flex items-center rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-brand-red"
                >
                  Approve — release to learners
                </button>
              </form>
              <form
                action={rejectWritingTest}
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
                    placeholder="e.g. visual data implausible"
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
