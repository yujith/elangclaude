import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { withOrg } from "@elc/db";
import { requireOrgContext } from "@/lib/auth/context";
import { SpeakingPractice } from "@/components/speaking-practice";
import { parseSpeakingContent } from "@/lib/speaking/content";

export const metadata: Metadata = {
  title: "Speaking practice",
};

export const dynamic = "force-dynamic";

type Params = { attemptId: string };

export default async function SpeakingPracticeAttemptPage({
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
      section: true,
      status: true,
      started_at: true,
      test: {
        select: {
          id: true,
          difficulty: true,
          body_json: true,
          section: true,
        },
      },
    },
  });

  if (!attempt || attempt.user_id !== ctx.user_id) notFound();
  if (attempt.section !== "Speaking" || attempt.test.section !== "Speaking") {
    notFound();
  }

  // Re-entering a finished session sends them back to the picker — grading +
  // results display land in Phase 4. (Phase 3 will redirect graded attempts
  // to /results/[attemptId] like Writing.)
  if (attempt.status !== "InProgress") {
    redirect("/practice/speaking");
  }

  const content = parseSpeakingContent(attempt.test.body_json);
  if (!content) {
    // The persisted body_json is malformed — refuse to render rather than
    // hand the runner a half-broken script.
    notFound();
  }

  return (
    <SpeakingPractice
      attemptId={attempt.id}
      content={content}
      difficulty={attempt.test.difficulty}
      startedAtIso={attempt.started_at.toISOString()}
    />
  );
}
