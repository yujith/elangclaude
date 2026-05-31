import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { withOrg } from "@elc/db";
import { requireOrgContext } from "@/lib/auth/context";
import { WritingPractice } from "@/components/writing-practice";
import { isWritingTaskType } from "@/lib/writing/task";

export const metadata: Metadata = {
  title: "Writing practice",
};

export const dynamic = "force-dynamic";

type Params = { attemptId: string };

type AnswerResponseShape = {
  text?: string;
  saved_at?: string;
};

function parseSavedResponse(
  raw: unknown,
): { text: string; savedAt: string | null } {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as AnswerResponseShape;
    return {
      text: typeof r.text === "string" ? r.text : "",
      savedAt: typeof r.saved_at === "string" ? r.saved_at : null,
    };
  }
  return { text: "", savedAt: null };
}

export default async function WritingPracticeAttemptPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { attemptId } = await params;
  const ctx = await requireOrgContext();
  const db = withOrg(ctx);

  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      user_id: true,
      status: true,
      started_at: true,
      test: {
        select: {
          id: true,
          questions: {
            select: { id: true, type: true, prompt: true, visual: true },
            orderBy: { position: "asc" },
            take: 1,
          },
        },
      },
      answers: {
        select: { response: true },
        take: 1,
      },
    },
  });

  if (!attempt || attempt.user_id !== ctx.user_id) notFound();

  // Already submitted? Don't let the learner edit a graded response.
  if (attempt.status !== "InProgress") {
    redirect(`/results/${attempt.id}`);
  }

  const question = attempt.test.questions[0];
  if (!question || !isWritingTaskType(question.type)) notFound();

  const existing = parseSavedResponse(attempt.answers[0]?.response);

  return (
    <WritingPractice
      attemptId={attempt.id}
      taskType={question.type}
      promptText={question.prompt}
      visualJson={question.visual ?? null}
      initialResponse={existing.text}
      initialSavedAtIso={existing.savedAt}
      startedAtIso={attempt.started_at.toISOString()}
      renderedAtIso={new Date().toISOString()}
    />
  );
}
