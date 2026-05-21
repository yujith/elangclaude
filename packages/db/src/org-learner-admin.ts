// OrgAdmin learner management.
//
// Pure DB-touching helpers for the OrgAdmin learner roster. The Next server
// actions in apps/web/lib/admin/invite-actions.ts are thin wrappers that run
// requireRole("OrgAdmin") and forward to these functions.
//
// Scope is intentionally narrow:
//   - OrgAdmins may only manage Learner rows in their own org.
//   - Soft-delete is supported; restore remains a future/SuperAdmin flow.
//   - Email changes are allowed, but collisions are refused generically so we
//     never leak where an existing email is already claimed.

import { Prisma, type Track } from "@prisma/client";
import { prisma } from "./client";
import { withOrg, type OrgContext } from "./tenancy";

export type OrgLearnerFailureReason =
  | "invalid_email"
  | "invalid_track"
  | "cannot_use_email"
  | "learner_not_found"
  | "learner_deleted";

export type UpdateLearnerResult =
  | { ok: true; user_id: string; changed: boolean }
  | { ok: false; reason: OrgLearnerFailureReason };

export type RemoveLearnerResult =
  | { ok: true; user_id: string }
  | { ok: false; reason: OrgLearnerFailureReason };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}

function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 200);
}

function normalizeTrack(raw: unknown): Track | null {
  return raw === "Academic" || raw === "GeneralTraining" ? raw : null;
}

async function loadManagedLearner(
  ctx: OrgContext,
  user_id: string,
): Promise<{
  id: string;
  email: string;
  name: string | null;
  role: "SuperAdmin" | "OrgAdmin" | "Learner";
  ielts_track: "Academic" | "GeneralTraining";
  deleted_at: Date | null;
} | null> {
  return withOrg(ctx).user.findUnique({
    where: { id: user_id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      ielts_track: true,
      deleted_at: true,
    },
  });
}

export async function updateLearnerForOrg(
  ctx: OrgContext,
  input: {
    user_id: string;
    email: string;
    name?: string | null;
    ielts_track: Track;
  },
): Promise<UpdateLearnerResult> {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, reason: "invalid_email" };
  const ielts_track = normalizeTrack(input.ielts_track);
  if (!ielts_track) return { ok: false, reason: "invalid_track" };
  const name = normalizeName(input.name);

  const learner = await loadManagedLearner(ctx, input.user_id);
  if (!learner || learner.role !== "Learner") {
    return { ok: false, reason: "learner_not_found" };
  }
  if (learner.deleted_at !== null) {
    return { ok: false, reason: "learner_deleted" };
  }
  const currentEmail = learner.email.trim().toLowerCase();

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing && existing.id !== learner.id) {
    return { ok: false, reason: "cannot_use_email" };
  }

  const changed_fields: string[] = [];
  if (email !== currentEmail) changed_fields.push("email");
  if (name !== learner.name) changed_fields.push("name");
  if (ielts_track !== learner.ielts_track) changed_fields.push("ielts_track");

  if (changed_fields.length === 0) {
    return { ok: true, user_id: learner.id, changed: false };
  }

  const metadata: Record<string, unknown> = {
    target_user_id: learner.id,
    changed_fields,
  };
  if (email !== learner.email) {
    metadata.email = { from: learner.email, to: email };
  }
  if (name !== learner.name) {
    metadata.name = { from: learner.name, to: name };
  }
  if (ielts_track !== learner.ielts_track) {
    metadata.ielts_track = { from: learner.ielts_track, to: ielts_track };
  }

  const db = withOrg(ctx);
  try {
    await db.$transaction([
      db.user.update({
        where: { id: learner.id },
        data: { email, name, ielts_track },
      }),
      db.activityLog.create({
        data: {
          org_id: ctx.org_id,
          user_id: ctx.user_id,
          action: "learner.updated",
          metadata: metadata as Prisma.InputJsonValue,
        },
      }),
    ]);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { ok: false, reason: "cannot_use_email" };
    }
    throw err;
  }

  return { ok: true, user_id: learner.id, changed: true };
}

export async function softDeleteLearnerForOrg(
  ctx: OrgContext,
  input: { user_id: string },
): Promise<RemoveLearnerResult> {
  const learner = await loadManagedLearner(ctx, input.user_id);
  if (!learner || learner.role !== "Learner") {
    return { ok: false, reason: "learner_not_found" };
  }
  if (learner.deleted_at !== null) {
    return { ok: true, user_id: learner.id };
  }

  const db = withOrg(ctx);
  await db.$transaction([
    db.user.update({
      where: { id: learner.id },
      data: { deleted_at: new Date() },
    }),
    db.activityLog.create({
      data: {
        org_id: ctx.org_id,
        user_id: ctx.user_id,
        action: "learner.removed",
        metadata: {
          target_user_id: learner.id,
          target_email: learner.email,
          prior_track: learner.ielts_track,
        } as Prisma.InputJsonValue,
      },
    }),
  ]);

  return { ok: true, user_id: learner.id };
}
