import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withOrg } from "@elc/db";
import {
  parseListeningGrade,
  parseReadingGrade,
  speakingGradeSchema,
  writingGradeSchema,
} from "@elc/ai";
import { signedDownloadUrl } from "@elc/storage";
import { requireOrgContext } from "@/lib/auth/context";
import { isWritingTaskType, taskShortLabel } from "@/lib/writing/task";
import { parseVisual } from "@/lib/writing/visual";
import { parseSpeakingContent } from "@/lib/speaking/content";
import { regradeAttempt } from "@/lib/attempts/actions";
import { regradeListeningAttempt } from "@/lib/listening/actions";
import { regradeReadingAttempt } from "@/lib/reading/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { GradeSummary } from "@/components/grade-summary";
import { TaskVisual } from "@/components/task-visual";
import { ListeningResult } from "@/components/listening-result";
import { ReadingResult } from "@/components/reading-result";
import { SpeakingResult } from "@/components/speaking-result";

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
      section: true,
      status: true,
      submitted_at: true,
      test: {
        select: {
          body_json: true,
          questions: {
            select: { id: true, type: true, prompt: true, visual: true },
            orderBy: { position: "asc" },
          },
        },
      },
      answers: {
        select: { question_id: true, response: true },
      },
      recording: {
        select: { storage_url: true, duration_sec: true },
      },
      grade: {
        select: {
          band_overall: true,
          criteria_scores_json: true,
        },
      },
    },
  });

  if (!attempt || attempt.user_id !== ctx.user_id) notFound();

  // ─── Speaking branch ──────────────────────────────────────────────────
  if (attempt.section === "Speaking") {
    const content = parseSpeakingContent(attempt.test.body_json);
    const transcripts = readSpeakingTranscripts(
      attempt.test.questions,
      attempt.answers,
    );

    // Try to mint a signed download URL for playback. If R2 credentials
    // aren't configured (Phase 3 dev environments without R2 set up) the
    // call throws — render the page without playback rather than 500.
    let audioUrl: string | null = null;
    if (attempt.recording?.storage_url) {
      try {
        audioUrl = await signedDownloadUrl({
          key: attempt.recording.storage_url,
          org_id: ctx.org_id,
        });
      } catch (err) {
        console.warn(
          "[results] signedDownloadUrl failed — playback disabled",
          err,
        );
      }
    }

    // Parse the grade if the row exists and the payload is well-formed.
    // A persisted-but-malformed grade falls back to the retry UI.
    const speakingGrade = attempt.grade
      ? speakingGradeSchema.safeParse(attempt.grade.criteria_scores_json)
      : null;

    const gradeError = pickSpeakingGradeError(
      speakingGrade && speakingGrade.success
        ? null
        : speakingGrade
          ? "shape"
          : sp.error,
    );

    return (
      <SpeakingResult
        attemptId={attempt.id}
        content={content}
        transcripts={transcripts}
        audioUrl={audioUrl}
        durationSec={attempt.recording?.duration_sec ?? null}
        grade={speakingGrade && speakingGrade.success ? speakingGrade.data : null}
        gradeError={gradeError}
      />
    );
  }

  // ─── Reading branch ───────────────────────────────────────────────────
  if (attempt.section === "Reading") {
    if (attempt.grade) {
      const reading = parseReadingGrade(attempt.grade.criteria_scores_json);
      if (reading) {
        return <ReadingResult grade={reading} />;
      }
    }
    return (
      <FailureCard
        title="Grading hit a snag."
        body="We couldn't read the grading payload for this Reading attempt. Try grading it again, or come back to the picker."
        retry={
          attempt.grade ? null : (
            <form action={regradeReadingAttempt}>
              <input type="hidden" name="attemptId" value={attempt.id} />
              <SubmitButton
                pendingLabel="Grading…"
                className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Try grading again
              </SubmitButton>
            </form>
          )
        }
        backHref="/practice/reading"
        backLabel="Back to Reading"
      />
    );
  }

  // ─── Listening branch ─────────────────────────────────────────────────
  if (attempt.section === "Listening") {
    if (attempt.grade) {
      const listening = parseListeningGrade(
        attempt.grade.criteria_scores_json,
      );
      if (listening) {
        return <ListeningResult grade={listening} />;
      }
    }
    return (
      <FailureCard
        title="Grading hit a snag."
        body="We couldn't read the grading payload for this Listening attempt. Try grading it again, or come back to the picker."
        retry={
          attempt.grade ? null : (
            <form action={regradeListeningAttempt}>
              <input type="hidden" name="attemptId" value={attempt.id} />
              <SubmitButton
                pendingLabel="Grading…"
                className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Try grading again
              </SubmitButton>
            </form>
          )
        }
        backHref="/practice/listening"
        backLabel="Back to Listening"
      />
    );
  }

  // ─── Writing branch (existing) ────────────────────────────────────────
  const question = attempt.test.questions[0];
  const taskTypeRaw = question?.type;
  const taskLabel =
    taskTypeRaw && isWritingTaskType(taskTypeRaw)
      ? taskShortLabel(taskTypeRaw)
      : "Writing";
  const visual = question?.visual ? parseVisual(question.visual) : null;
  const promptText = question?.prompt ?? "";
  const responseText = readResponseText(attempt.answers[0]?.response);

  if (attempt.grade) {
    const parsed = writingGradeSchema.safeParse(
      attempt.grade.criteria_scores_json,
    );
    if (parsed.success) {
      return (
        <section className="bg-brand-grey-50 px-6 py-12 md:py-16">
          <div className="mx-auto max-w-4xl">
            <header className="mb-8">
              <p className="font-body text-sm uppercase tracking-widest text-brand-red">
                Result
              </p>
              <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
                Here&apos;s where you landed.
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
    // Persisted row is malformed — fall through to the failure UI below.
  }

  const errorKind = sp.error;
  return (
    <section className="bg-brand-grey-50 px-6 py-16 md:py-24">
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
              Our AI examiner couldn&apos;t finish grading this attempt. Your
              response is saved — you can try grading it again. If it keeps
              failing, your admin will see it in the logs.
            </p>
            <div className="flex flex-wrap gap-3">
              <form action={regradeAttempt}>
                <input type="hidden" name="attemptId" value={attempt.id} />
                <SubmitButton
                  pendingLabel="Grading…"
                  className="inline-flex items-center gap-2 rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Try grading again
                </SubmitButton>
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

function FailureCard({
  title,
  body,
  retry,
  backHref,
  backLabel,
}: {
  title: string;
  body: string;
  retry: React.ReactNode | null;
  backHref: string;
  backLabel: string;
}) {
  return (
    <section className="bg-brand-grey-50 px-6 py-16 md:py-24">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6">
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Reading
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            {title}
          </h1>
        </header>
        <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-4">
          <p className="font-body text-base text-brand-grey-900">{body}</p>
          <div className="flex flex-wrap gap-3">
            {retry}
            <Link
              href={backHref}
              className="inline-flex items-center gap-2 rounded-pill bg-brand-black px-5 py-2.5 font-heading font-bold text-white transition-colors hover:bg-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              {backLabel}
            </Link>
          </div>
        </div>
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

function pickSpeakingGradeError(
  raw: string | null | undefined,
): "quota" | "grading" | "unknown" | "shape" | null {
  if (raw === "quota" || raw === "grading" || raw === "unknown" || raw === "shape") {
    return raw;
  }
  return null;
}

function readSpeakingTranscripts(
  questions: { id: string; type: string }[],
  answers: { question_id: string; response: unknown }[],
): { part1: string; part2: string; part3: string } {
  const idByType = new Map<string, string>();
  for (const q of questions) idByType.set(q.type, q.id);
  const textByQuestion = new Map<string, string>();
  for (const a of answers) {
    textByQuestion.set(a.question_id, readResponseText(a.response));
  }
  return {
    part1:
      textByQuestion.get(idByType.get("speaking-part-1") ?? "") ?? "",
    part2:
      textByQuestion.get(idByType.get("speaking-part-2-cue") ?? "") ?? "",
    part3:
      textByQuestion.get(idByType.get("speaking-part-3") ?? "") ?? "",
  };
}
