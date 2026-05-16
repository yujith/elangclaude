import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { withOrg } from "@elc/db";
import {
  isListeningQuestionKind,
  parseListeningContent,
  parseListeningQuestionPayload,
} from "@elc/ai";
import { requireOrgContext } from "@/lib/auth/context";
import {
  ListeningPractice,
  type ListeningRunnerPart,
  type ListeningRunnerQuestion,
} from "@/components/listening-practice";

export const metadata: Metadata = {
  title: "Listening practice",
};

export const dynamic = "force-dynamic";

type Params = { attemptId: string };

export default async function ListeningPracticeAttemptPage({
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
      mock_session_id: true,
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
              points: true,
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

  const content = parseListeningContent(attempt.test.body_json);
  if (!content) notFound();

  // Build the runner-shaped questions. correct_answer is STRIPPED — the
  // payload sent to the client carries only the fields the renderer needs
  // (options without `correct`, word_limit without `accepted`, block/slot
  // references without `accepted`). Identical to the Reading runner's
  // server-strip pattern.
  const runnerQuestions: ListeningRunnerQuestion[] = [];
  for (const q of attempt.test.questions) {
    if (!isListeningQuestionKind(q.type)) continue;
    const payload = parseListeningQuestionPayload(q.type, q.correct_answer);
    if (!payload) continue;
    switch (payload.kind) {
      case "listening-mcq-single":
        runnerQuestions.push({
          id: q.id,
          position: q.position,
          prompt: q.prompt,
          points: q.points,
          payload: { kind: payload.kind, options: payload.options },
        });
        break;
      case "listening-mcq-multi":
        runnerQuestions.push({
          id: q.id,
          position: q.position,
          prompt: q.prompt,
          points: q.points,
          payload: {
            kind: payload.kind,
            options: payload.options,
            pick_count: payload.pick_count,
          },
        });
        break;
      case "listening-sentence-completion":
        runnerQuestions.push({
          id: q.id,
          position: q.position,
          prompt: q.prompt,
          points: q.points,
          payload: {
            kind: payload.kind,
            stem: payload.stem,
            word_limit: payload.word_limit,
          },
        });
        break;
      case "listening-short-answer":
        runnerQuestions.push({
          id: q.id,
          position: q.position,
          prompt: q.prompt,
          points: q.points,
          payload: {
            kind: payload.kind,
            word_limit: payload.word_limit,
          },
        });
        break;
      case "listening-completion-blank":
        runnerQuestions.push({
          id: q.id,
          position: q.position,
          prompt: q.prompt,
          points: q.points,
          payload: {
            kind: payload.kind,
            block_id: payload.block_id,
            slot_id: payload.slot_id,
            word_limit: payload.word_limit,
          },
        });
        break;
    }
  }

  if (runnerQuestions.length === 0) notFound();

  // Project the parsed content into the runner-friendly shape. Each part
  // carries its transcript (with optional clip metadata — the client mints
  // signed URLs lazily via the issueSignedAudioUrl action) and its
  // completion_blocks.
  const runnerParts: ListeningRunnerPart[] = content.parts.map((part) => ({
    part: part.part,
    context: part.context,
    title: part.title,
    speakers: part.speakers.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      accent: s.accent,
    })),
    question_positions: [...part.question_positions],
    transcript: part.transcript.map((seg) => {
      if (seg.kind === "narration") {
        return {
          kind: "narration" as const,
          text: seg.text,
          audio_sha256: seg.audio_clip?.sha256 ?? null,
        };
      }
      if (seg.kind === "speech") {
        return {
          kind: "speech" as const,
          speaker_id: seg.speaker_id,
          text: seg.text,
          audio_sha256: seg.audio_clip?.sha256 ?? null,
        };
      }
      if (seg.kind === "reading-pause") {
        return {
          kind: "reading-pause" as const,
          seconds: seg.seconds,
          instruction: seg.instruction ?? null,
        };
      }
      return {
        kind: "questions-preview" as const,
        seconds: seg.seconds,
        question_positions: [...seg.question_positions],
      };
    }),
    completion_blocks: (part.completion_blocks ?? []).map((b) => ({
      id: b.id,
      layout: b.layout,
      title: b.title ?? null,
      instructions: b.instructions ?? null,
      rows: b.rows.map((r) => ({
        label: r.label ?? null,
        is_header: r.is_header ?? false,
        cells: r.cells.map((cell) =>
          cell.map((seg) =>
            seg.kind === "text"
              ? { kind: "text" as const, text: seg.text }
              : { kind: "blank" as const, slot_id: seg.slot_id },
          ),
        ),
      })),
    })),
  }));

  // Recover any saved responses keyed by question id so the runner shows
  // partial progress on reload.
  const initial: Record<string, unknown> = {};
  for (const a of attempt.answers) initial[a.question_id] = a.response;

  // If this attempt belongs to a Full Mock session, force strict-mode
  // playback per ADR 0008. Standalone practice stays in practice mode.
  const mode = attempt.mock_session_id ? "strict" : "practice";

  return (
    <ListeningPractice
      attemptId={attempt.id}
      startedAtIso={attempt.started_at.toISOString()}
      parts={runnerParts}
      questions={runnerQuestions}
      initialResponses={initial}
      mode={mode}
    />
  );
}
