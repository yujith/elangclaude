import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { withOrg } from "@elc/db";
import {
  isReadingQuestionKind,
  parseReadingPassage,
  parseReadingQuestionPayload,
  passageNeedsParagraphLabels,
} from "@elc/ai";
import { requireOrgContext } from "@/lib/auth/context";
import {
  ReadingPractice,
  type RunnerQuestion,
} from "@/components/reading-practice";

export const metadata: Metadata = {
  title: "Reading practice",
};

export const dynamic = "force-dynamic";

type Params = { attemptId: string };

export default async function ReadingPracticeAttemptPage({
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
          body_json: true,
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
      },
      answers: {
        select: { question_id: true, response: true },
      },
    },
  });

  if (!attempt || attempt.user_id !== ctx.user_id) notFound();
  if (attempt.status !== "InProgress") {
    redirect(`/results/${attempt.id}`);
  }

  const passage = parseReadingPassage(attempt.test.body_json);
  if (!passage) notFound();

  // Build the runner-shaped question list. The server strips correct
  // answers before they reach the client and projects the bank text for
  // matching-* questions from the passage's matching_groups so the
  // renderer doesn't need a second round-trip to look them up.
  const groupById = new Map<string, { key: string; text: string }[]>();
  if (passage.matching_groups) {
    for (const g of passage.matching_groups) groupById.set(g.id, g.items);
  }
  const groupReuseById = new Map<string, boolean>();
  if (passage.matching_groups) {
    for (const g of passage.matching_groups) {
      groupReuseById.set(g.id, Boolean(g.allow_reuse));
    }
  }
  const paragraphLabels = passage.paragraphs.map((p) => p.label);

  const runnerQuestions: RunnerQuestion[] = [];
  for (const q of attempt.test.questions) {
    if (!isReadingQuestionKind(q.type)) continue;
    const payload = parseReadingQuestionPayload(q.type, q.correct_answer);
    if (!payload) continue;
    switch (payload.kind) {
      case "reading-mcq":
        runnerQuestions.push({
          id: q.id,
          position: q.position,
          prompt: q.prompt,
          payload: { kind: "reading-mcq", options: payload.options },
        });
        break;
      case "reading-true-false-not-given":
      case "reading-yes-no-not-given":
        runnerQuestions.push({
          id: q.id,
          position: q.position,
          prompt: q.prompt,
          payload: { kind: payload.kind },
        });
        break;
      case "reading-sentence-completion":
        runnerQuestions.push({
          id: q.id,
          position: q.position,
          prompt: q.prompt,
          payload: {
            kind: "reading-sentence-completion",
            stem: payload.stem,
            word_limit: payload.word_limit,
          },
        });
        break;
      case "reading-matching-headings":
      case "reading-matching-features":
      case "reading-matching-sentence-endings": {
        const items = groupById.get(payload.group_id);
        if (!items) continue;
        runnerQuestions.push({
          id: q.id,
          position: q.position,
          prompt: q.prompt,
          payload: {
            kind: payload.kind,
            group_id: payload.group_id,
            items,
            allow_reuse: groupReuseById.get(payload.group_id) ?? false,
          },
        });
        break;
      }
      case "reading-matching-information":
        runnerQuestions.push({
          id: q.id,
          position: q.position,
          prompt: q.prompt,
          payload: {
            kind: "reading-matching-information",
            paragraph_labels: paragraphLabels,
          },
        });
        break;
      case "reading-short-answer":
        runnerQuestions.push({
          id: q.id,
          position: q.position,
          prompt: q.prompt,
          payload: {
            kind: "reading-short-answer",
            word_limit: payload.word_limit,
          },
        });
        break;
      case "reading-completion-blank":
        runnerQuestions.push({
          id: q.id,
          position: q.position,
          prompt: q.prompt,
          payload: {
            kind: "reading-completion-blank",
            block_id: payload.block_id,
            slot_id: payload.slot_id,
            word_limit: payload.word_limit,
          },
        });
        break;
    }
  }

  if (runnerQuestions.length === 0) notFound();

  // Recover any saved responses keyed by question id so the runner shows
  // partial progress on reload.
  const initial: Record<string, unknown> = {};
  for (const a of attempt.answers) initial[a.question_id] = a.response;

  const showParagraphLabels = passageNeedsParagraphLabels(
    attempt.test.questions.map((q) => q.type),
  );

  return (
    <ReadingPractice
      attemptId={attempt.id}
      startedAtIso={attempt.started_at.toISOString()}
      renderedAtIso={new Date().toISOString()}
      passage={passage}
      completionBlocks={passage.completion_blocks ?? []}
      questions={runnerQuestions}
      initialResponses={initial}
      showParagraphLabels={showParagraphLabels}
    />
  );
}
