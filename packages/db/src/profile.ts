// Self-service profile updates.
//
// The caller (any authenticated role) can update their own `ielts_track`.
// This is intentionally narrow — name/email/avatar live elsewhere. Track is
// special because section pickers and the mock launcher filter by it, so a
// silent switch can strand in-progress work under the opposite filter.
//
// Rule of engagement (ADR-0016 D1): refuse the switch if the caller has any
// in-progress Attempt or MockSession. The caller must finish or abandon
// first.

import { Prisma, type Track } from "@prisma/client";
import { withOrg, type OrgContext } from "./tenancy";

export type UpdateTrackFailureReason = "invalid_track" | "in_progress_work";

export type UpdateTrackResult =
  | { ok: true; ielts_track: Track; changed: boolean }
  | { ok: false; reason: UpdateTrackFailureReason };

function normalizeTrack(raw: unknown): Track | null {
  return raw === "Academic" || raw === "GeneralTraining" ? raw : null;
}

export async function updateMyIeltsTrack(
  ctx: OrgContext,
  input: { ielts_track: Track | string },
): Promise<UpdateTrackResult> {
  const ielts_track = normalizeTrack(input.ielts_track);
  if (!ielts_track) return { ok: false, reason: "invalid_track" };

  const db = withOrg(ctx);
  const me = await db.user.findUnique({
    where: { id: ctx.user_id },
    select: { id: true, ielts_track: true },
  });
  if (!me) return { ok: false, reason: "invalid_track" };

  if (me.ielts_track === ielts_track) {
    return { ok: true, ielts_track, changed: false };
  }

  // Block mid-attempt switching. Section pickers and the mock launcher
  // filter approved tests by user.ielts_track; a silent flip strands the
  // in-progress row behind the opposite filter until the learner toggles
  // back. See ADR-0016 D1.
  const [inProgressAttempt, inProgressMock] = await Promise.all([
    db.attempt.findFirst({
      where: { user_id: ctx.user_id, status: "InProgress" },
      select: { id: true },
    }),
    db.mockSession.findFirst({
      where: { user_id: ctx.user_id, status: "InProgress" },
      select: { id: true },
    }),
  ]);
  if (inProgressAttempt || inProgressMock) {
    return { ok: false, reason: "in_progress_work" };
  }

  await db.$transaction([
    db.user.update({
      where: { id: ctx.user_id },
      data: { ielts_track },
    }),
    db.activityLog.create({
      data: {
        org_id: ctx.org_id,
        user_id: ctx.user_id,
        action: "profile.track_changed",
        metadata: {
          from: me.ielts_track,
          to: ielts_track,
        } as Prisma.InputJsonValue,
      },
    }),
  ]);

  return { ok: true, ielts_track, changed: true };
}

export async function hasInProgressWork(ctx: OrgContext): Promise<boolean> {
  const db = withOrg(ctx);
  const [attempt, mock] = await Promise.all([
    db.attempt.findFirst({
      where: { user_id: ctx.user_id, status: "InProgress" },
      select: { id: true },
    }),
    db.mockSession.findFirst({
      where: { user_id: ctx.user_id, status: "InProgress" },
      select: { id: true },
    }),
  ]);
  return Boolean(attempt || mock);
}
