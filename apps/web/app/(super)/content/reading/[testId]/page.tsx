import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withSuperAdminContext } from "@elc/db";
import {
  isReadingQuestionKind,
  parseReadingPassage,
  parseReadingQuestionPayload,
  passageNeedsParagraphLabels,
  type ReadingQuestionPayload,
} from "@elc/ai";
import { requireRole } from "@/lib/auth/context";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  approveReadingTest,
  rejectReadingTest,
} from "@/lib/reading/moderation-actions";
import {
  parseReadingIssueCodes,
  validateReadingReviewRecord,
} from "@/lib/reading/review-validation";

export const metadata: Metadata = {
  title: "Review Reading test",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Params = { testId: string };
type SearchParams = {
  approved?: string;
  approve_error?: string;
  validation_issues?: string;
};

function formatIssueCodes(issueCodes: string[]): string {
  return issueCodes.join(", ");
}

function readStoredPassageTitle(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  return typeof value.title === "string" ? value.title : null;
}

export default async function ReviewReadingTestPage({
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
      generated_model: true,
      approved_by: true,
      questions: {
        select: {
          id: true,
          type: true,
          prompt: true,
          position: true,
          correct_answer: true,
        },
        orderBy: { position: "asc" },
      },
    },
  });
  if (!test || test.section !== "Reading") notFound();
  const passage = parseReadingPassage(test.body_json);
  const issueCodes = parseReadingIssueCodes(sp.validation_issues);
  const reviewValidation = validateReadingReviewRecord({
    track: test.track,
    difficulty: test.difficulty,
    body_json: test.body_json,
    questions: test.questions,
  });
  const showParagraphLabels =
    passage !== null &&
    passageNeedsParagraphLabels(test.questions.map((q) => q.type));

  const trackLabel =
    test.track === "Academic" ? "Academic" : "General Training";
  const status = test.status;
  const title =
    passage?.title ??
    readStoredPassageTitle(test.body_json) ??
    "(unrenderable passage)";
  const approvalBlocked = status === "PendingReview" && !reviewValidation.ok;
  const currentIssueCodes = reviewValidation.ok ? [] : reviewValidation.issueCodes;

  return (
    <section className="px-6 py-10 md:py-12">
      <div className="mx-auto max-w-5xl space-y-8">
        <nav>
          <Link
            href="/content/reading"
            className="font-body text-sm text-brand-grey-700 hover:text-brand-red"
          >
            ← Back to queue
          </Link>
        </nav>

        <header className="space-y-2">
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Review · {trackLabel} · difficulty {test.difficulty}
          </p>
          <h1 className="font-display italic font-bold text-3xl md:text-4xl text-brand-black leading-tight">
            {title}
          </h1>
          <p className="font-body text-sm text-brand-grey-700">
            Status <code>{status}</code> · generated{" "}
            {test.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC · test
            id <code>{test.id}</code>
            {test.generated_model ? (
              <>
                {" "}
                · model <code>{test.generated_model}</code>
              </>
            ) : null}
          </p>
        </header>

        {sp.approved ? (
          <Banner tone="success">
            This test is already approved. It is now visible to {trackLabel}{" "}
            learners on the picker.
          </Banner>
        ) : null}
        {sp.approve_error && issueCodes.length > 0 ? (
          <Banner tone="error">
            Approval was blocked because this test does not currently satisfy
            the Reading contract. Issue codes:{" "}
            <code>{formatIssueCodes(issueCodes)}</code>.
          </Banner>
        ) : null}
        {approvalBlocked ? (
          <Banner tone="error">
            This test cannot be approved in its current state. Fix or reject
            it first. Issue codes:{" "}
            <code>{formatIssueCodes(currentIssueCodes)}</code>.
          </Banner>
        ) : null}

        <article className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-4">
          <h2 className="font-heading font-bold text-xl text-brand-black">
            Passage as the learner will see it
          </h2>
          {passage ? (
            <>
              <div className="space-y-4">
                {passage.paragraphs.map((p) => (
                  <p
                    key={p.label}
                    className="font-body text-base text-brand-grey-900 leading-relaxed"
                  >
                    {showParagraphLabels ? (
                      <span className="font-heading font-bold text-brand-red mr-2">
                        {p.label}
                      </span>
                    ) : null}
                    {p.text}
                  </p>
                ))}
              </div>
              {!showParagraphLabels ? (
                <p className="mt-3 font-body text-xs text-brand-grey-500">
                  Paragraph letters are hidden — this test has no
                  matching-headings or matching-information questions, so the
                  learner sees continuous prose.
                </p>
              ) : null}
            </>
          ) : (
            <Banner tone="error">
              This stored passage payload no longer parses in the Reading
              renderer. Reject it or repair the data before approval.
            </Banner>
          )}
        </article>

        <article className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-4">
          <h2 className="font-heading font-bold text-xl text-brand-black">
            Questions ({test.questions.length}) — answer key visible
          </h2>
          <ol className="space-y-5">
            {test.questions.map((q) => {
              const valid = isReadingQuestionKind(q.type);
              const payload = valid
                ? parseReadingQuestionPayload(q.type, q.correct_answer)
                : null;
              return (
                <li
                  key={q.id}
                  className="border-t border-brand-grey-200 pt-5 first:border-t-0 first:pt-0"
                >
                  <p className="font-heading font-bold text-base text-brand-black">
                    <span className="text-brand-red mr-2">
                      {q.position + 1}.
                    </span>
                    <span className="font-body text-xs text-brand-grey-500 mr-2">
                      [{q.type}]
                    </span>
                    <span className="whitespace-pre-wrap">{q.prompt}</span>
                  </p>
                  <div className="mt-2">
                    {payload ? (
                      <AnswerKey payload={payload} />
                    ) : (
                      <p className="font-body text-sm text-brand-red">
                        Unsupported or malformed payload. This question should
                        be rejected at moderation.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </article>

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
              <form action={approveReadingTest}>
                <input type="hidden" name="testId" value={test.id} />
                <SubmitButton
                  disabled={approvalBlocked}
                  pendingLabel="Approving…"
                  className="inline-flex items-center rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-brand-red"
                >
                  Approve — release to learners
                </SubmitButton>
              </form>
              <form
                action={rejectReadingTest}
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
                    placeholder="e.g. answers not in passage"
                    className="w-72 rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                  />
                </div>
                <SubmitButton
                  pendingLabel="Rejecting…"
                  className="inline-flex items-center rounded-pill bg-brand-black px-6 py-3 font-heading font-bold text-white transition-colors hover:bg-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Reject
                </SubmitButton>
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

function AnswerKey({ payload }: { payload: ReadingQuestionPayload }) {
  switch (payload.kind) {
    case "reading-mcq": {
      const correct = payload.options.find((o) => o.id === payload.correct);
      return (
        <p className="font-body text-sm text-brand-grey-900">
          <span className="font-heading font-bold text-brand-grey-500 mr-2 uppercase tracking-wide text-xs">
            Answer
          </span>
          <code className="font-heading font-bold text-brand-black">
            {payload.correct}
          </code>
          {correct ? ` — ${correct.text}` : null}
        </p>
      );
    }
    case "reading-true-false-not-given":
    case "reading-yes-no-not-given":
      return (
        <p className="font-body text-sm text-brand-grey-900">
          <span className="font-heading font-bold text-brand-grey-500 mr-2 uppercase tracking-wide text-xs">
            Answer
          </span>
          <code className="font-heading font-bold text-brand-black">
            {payload.correct.toUpperCase()}
          </code>
        </p>
      );
    case "reading-sentence-completion":
      return (
        <div className="font-body text-sm text-brand-grey-900 space-y-1">
          <p>
            <span className="font-heading font-bold text-brand-grey-500 mr-2 uppercase tracking-wide text-xs">
              Stem
            </span>
            {payload.stem}
          </p>
          <p>
            <span className="font-heading font-bold text-brand-grey-500 mr-2 uppercase tracking-wide text-xs">
              Accepted ({payload.word_limit} words max)
            </span>
            <code className="font-heading font-bold text-brand-black">
              {payload.accepted.join(" / ")}
            </code>
          </p>
        </div>
      );
    case "reading-short-answer":
      return (
        <p className="font-body text-sm text-brand-grey-900">
          <span className="font-heading font-bold text-brand-grey-500 mr-2 uppercase tracking-wide text-xs">
            Accepted ({payload.word_limit} words max)
          </span>
          <code className="font-heading font-bold text-brand-black">
            {payload.accepted.join(" / ")}
          </code>
        </p>
      );
    case "reading-matching-headings":
    case "reading-matching-features":
    case "reading-matching-sentence-endings":
      return (
        <p className="font-body text-sm text-brand-grey-900">
          <span className="font-heading font-bold text-brand-grey-500 mr-2 uppercase tracking-wide text-xs">
            Answer (group {payload.group_id})
          </span>
          <code className="font-heading font-bold text-brand-black">
            {payload.correct}
          </code>
        </p>
      );
    case "reading-matching-information":
      return (
        <p className="font-body text-sm text-brand-grey-900">
          <span className="font-heading font-bold text-brand-grey-500 mr-2 uppercase tracking-wide text-xs">
            Answer
          </span>
          Paragraph{" "}
          <code className="font-heading font-bold text-brand-black">
            {payload.correct}
          </code>
        </p>
      );
    case "reading-completion-blank":
      return (
        <p className="font-body text-sm text-brand-grey-900">
          <span className="font-heading font-bold text-brand-grey-500 mr-2 uppercase tracking-wide text-xs">
            Block {payload.block_id} · slot {payload.slot_id} (
            {payload.word_limit} words max)
          </span>
          <code className="font-heading font-bold text-brand-black">
            {payload.accepted.join(" / ")}
          </code>
        </p>
      );
  }
}
