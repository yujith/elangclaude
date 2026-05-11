import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withOrg } from "@elc/db";
import { writingGradeSchema } from "@elc/ai";
import { requireOrgContext } from "@/lib/auth/context";
import { isWritingTaskType, taskShortLabel } from "@/lib/writing/task";
import { parseVisual } from "@/lib/writing/visual";
import { regradeAttempt } from "@/lib/attempts/actions";
import { GradeSummary } from "@/components/grade-summary";
import { TaskVisual } from "@/components/task-visual";

export const metadata: Metadata = {
  title: "Result",
};

export const dynamic = "force-dynamic";

type Params = { attemptId: string };
type SearchParams = { error?: string };

export default async function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ attemptId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);

  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      user_id: true,
      status: true,
      submitted_at: true,
      test: {
        select: {
          questions: {
            select: { type: true, prompt: true, visual: true },
            orderBy: { position: "asc" },
            take: 1,
          },
        },
      },
      answers: { select: { response: true }, take: 1 },
      grade: {
        select: {
          band_overall: true,
          criteria_scores_json: true,
        },
      },
    },
  });

  if (!attempt || attempt.user_id !== ctx.user_id) notFound();

  const question = attempt.test.questions[0];
  const taskTypeRaw = question?.type;
  const taskLabel =
    taskTypeRaw && isWritingTaskType(taskTypeRaw)
      ? taskShortLabel(taskTypeRaw)
      : "Writing";
  const visual = question?.visual ? parseVisual(question.visual) : null;
  const promptText = question?.prompt ?? "";
  const responseText = readResponseText(attempt.answers[0]?.response);

  // Happy path: we have a Grade row and its JSON parses through the
  // canonical schema. (The grader validates before persisting, but we
  // re-parse here as a belt-and-suspenders against any drift between the
  // grader version that wrote the row and the schema we read it with.)
  if (attempt.grade) {
    const parsed = writingGradeSchema.safeParse(
      attempt.grade.criteria_scores_json,
    );
    if (parsed.success) {
      return (
        <section className="px-6 py-12 md:py-16">
          <div className="mx-auto max-w-4xl">
            <header className="mb-8">
              <p className="font-body text-sm uppercase tracking-widest text-brand-red">
                Result
              </p>
              <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
                Here's where you landed.
              </h1>
            </header>

            {(visual || promptText || responseText) && (
              <details className="mb-8 rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
                <summary className="cursor-pointer font-heading font-bold text-lg text-brand-black flex items-center gap-2 select-none">
                  Review the original task and your response
                </summary>
                <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <div>
                    <h3 className="font-heading font-bold text-sm uppercase tracking-wide text-brand-grey-500 mb-2">
                      Task
                    </h3>
                    {visual ? (
                      <div className="mb-4">
                        <TaskVisual visual={visual} />
                      </div>
                    ) : null}
                    {promptText ? (
                      <p className="font-body text-sm text-brand-grey-900 leading-relaxed whitespace-pre-wrap">
                        {promptText}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <h3 className="font-heading font-bold text-sm uppercase tracking-wide text-brand-grey-500 mb-2">
                      Your response
                    </h3>
                    <p className="font-body text-sm text-brand-grey-900 leading-relaxed whitespace-pre-wrap">
                      {responseText || "—"}
                    </p>
                  </div>
                </div>
              </details>
            )}

            <GradeSummary taskTypeLabel={taskLabel} grade={parsed.data} />
          </div>
        </section>
      );
    }
    // Persisted row is malformed — surface as a grading error and let the
    // learner retry rather than render half-broken UI.
  }

  // No grade yet. Decide which non-graded state we're in.
  const errorKind = sp.error;
  return (
    <section className="px-6 py-16 md:py-24">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6">
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            {taskLabel}
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            {errorKind === "quota"
              ? "You've hit today's AI limit."
              : "Grading hit a snag."}
          </h1>
        </header>

        {errorKind === "quota" ? (
          <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-4">
            <p className="font-body text-base text-brand-grey-900">
              Your daily AI grading quota has been used up. It resets at
              midnight UTC. Your response is saved — you can come back and
              grade it then.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/practice/writing"
                className="inline-flex items-center gap-2 rounded-pill bg-brand-black px-5 py-2.5 font-heading font-bold text-white transition-colors hover:bg-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
              >
                Back to picker
              </Link>
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-4">
            <p className="font-body text-base text-brand-grey-900">
              Our AI examiner couldn't finish grading this attempt. Your
              response is saved — you can try grading it again. If it keeps
              failing, your admin will see it in the logs.
            </p>
            <div className="flex flex-wrap gap-3">
              <form action={regradeAttempt}>
                <input type="hidden" name="attemptId" value={attempt.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
                >
                  Try grading again
                </button>
              </form>
              <Link
                href="/practice/writing"
                className="inline-flex items-center gap-2 rounded-pill bg-brand-black px-5 py-2.5 font-heading font-bold text-white transition-colors hover:bg-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
              >
                Back to picker
              </Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function readResponseText(raw: unknown): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as { text?: unknown };
    if (typeof obj.text === "string") return obj.text;
  }
  return "";
}
