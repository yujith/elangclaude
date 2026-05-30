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

export type LearnerRosterWindow = "today" | "week" | "month";

export type LearnerRosterFilters = {
  q?: string | null;
  track?: Track | null;
  activity?: LearnerRosterWindow | null;
  inactive?: Exclude<LearnerRosterWindow, "today"> | null;
  minCalls?: number | null;
  page?: number;
  pageSize?: number;
};

export type OrgLearnerRosterRow = {
  id: string;
  email: string;
  name: string | null;
  ielts_track: Track;
  createdAt: Date;
  callsToday: number;
  callsWeek: number;
  callsMonth: number;
  attemptsCount: number;
  latestBand: number | null;
  lastActivityAt: Date | null;
};

export type OrgLearnerRoster = {
  learners: OrgLearnerRosterRow[];
  counts: {
    active: number;
    all: number;
    removed: number;
    filtered: number;
  };
  page: {
    current: number;
    pageSize: number;
    pageCount: number;
    rangeStart: number;
    rangeEnd: number;
  };
};

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

function normalizeSearch(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 200);
}

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function startOfUtcWeek(d: Date): Date {
  const dayStart = startOfUtcDay(d);
  const daysSinceMonday = (dayStart.getUTCDay() + 6) % 7;
  return new Date(dayStart.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
}

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function decimalToNumber(d: Prisma.Decimal | number | null | undefined): number | null {
  if (d === null || d === undefined) return null;
  if (typeof d === "number") return d;
  return Number(d.toString());
}

function latestDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

function callsForWindow(row: OrgLearnerRosterRow, window: LearnerRosterWindow): number {
  if (window === "today") return row.callsToday;
  if (window === "week") return row.callsWeek;
  return row.callsMonth;
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

export async function loadOrgLearnerRoster(
  ctx: OrgContext,
  filters: LearnerRosterFilters = {},
  now: Date = new Date(),
): Promise<OrgLearnerRoster> {
  const db = withOrg(ctx);
  const pageSize = Math.max(1, Math.min(filters.pageSize ?? 50, 200));
  const requestedPage = Math.max(1, filters.page ?? 1);
  const q = normalizeSearch(filters.q);
  const track = normalizeTrack(filters.track);
  const activity = filters.activity ?? null;
  const inactive = filters.inactive ?? null;
  const minCalls =
    typeof filters.minCalls === "number" && Number.isFinite(filters.minCalls)
      ? Math.max(0, Math.floor(filters.minCalls))
      : null;

  const todayStart = startOfUtcDay(now);
  const weekStart = startOfUtcWeek(now);
  const monthStart = startOfUtcMonth(now);

  const learnerWhere = {
    role: "Learner" as const,
    deleted_at: null,
    ...(track ? { ielts_track: track } : {}),
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" as const } },
            { name: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [activeLearnerCount, learnerCountAll, baseLearners] = await Promise.all([
    db.user.count({ where: { role: "Learner", deleted_at: null } }),
    db.user.count({ where: { role: "Learner" } }),
    db.user.findMany({
      where: learnerWhere,
      select: {
        id: true,
        email: true,
        name: true,
        ielts_track: true,
        createdAt: true,
      },
    }),
  ]);

  const learnerIds = baseLearners.map((l) => l.id);
  const [usageRows, attempts] =
    learnerIds.length === 0
      ? [[], []] as const
      : await Promise.all([
          db.quotaUsage.findMany({
            where: {
              user_id: { in: learnerIds },
              date: { gte: monthStart },
            },
            select: {
              user_id: true,
              date: true,
              ai_calls_count: true,
            },
          }),
          db.attempt.findMany({
            where: {
              user_id: { in: learnerIds },
              status: { in: ["InProgress", "Submitted", "Graded"] },
            },
            select: {
              user_id: true,
              status: true,
              started_at: true,
              submitted_at: true,
              grade: { select: { band_overall: true, graded_at: true } },
            },
          }),
        ]);

  const rowsByUser = new Map<string, OrgLearnerRosterRow>();
  for (const learner of baseLearners) {
    rowsByUser.set(learner.id, {
      ...learner,
      callsToday: 0,
      callsWeek: 0,
      callsMonth: 0,
      attemptsCount: 0,
      latestBand: null,
      lastActivityAt: null,
    });
  }

  for (const usage of usageRows) {
    const row = rowsByUser.get(usage.user_id);
    if (!row) continue;
    const ts = usage.date.getTime();
    if (ts >= monthStart.getTime()) row.callsMonth += usage.ai_calls_count;
    if (ts >= weekStart.getTime()) row.callsWeek += usage.ai_calls_count;
    if (ts >= todayStart.getTime()) row.callsToday += usage.ai_calls_count;
  }

  const latestGradeAtByUser = new Map<string, Date>();
  for (const attempt of attempts) {
    const row = rowsByUser.get(attempt.user_id);
    if (!row) continue;
    row.attemptsCount += 1;
    row.lastActivityAt = latestDate(
      row.lastActivityAt,
      attempt.submitted_at ?? attempt.started_at,
    );

    if (attempt.status === "Graded" && attempt.grade) {
      const gradeAt = attempt.grade.graded_at;
      const existing = latestGradeAtByUser.get(attempt.user_id);
      if (!existing || gradeAt.getTime() > existing.getTime()) {
        latestGradeAtByUser.set(attempt.user_id, gradeAt);
        row.latestBand = decimalToNumber(attempt.grade.band_overall);
      }
    }
  }

  let rows = [...rowsByUser.values()];
  if (activity) {
    const start =
      activity === "today"
        ? todayStart
        : activity === "week"
          ? weekStart
          : monthStart;
    rows = rows.filter(
      (row) => row.lastActivityAt && row.lastActivityAt >= start,
    );
  } else if (inactive) {
    const start = inactive === "week" ? weekStart : monthStart;
    rows = rows.filter(
      (row) => !row.lastActivityAt || row.lastActivityAt < start,
    );
  }

  if (minCalls !== null && minCalls > 0) {
    const usageWindow = activity ?? "month";
    rows = rows.filter((row) => callsForWindow(row, usageWindow) >= minCalls);
  }

  rows.sort((a, b) => {
    const usageDiff = b.callsWeek - a.callsWeek;
    if (usageDiff !== 0) return usageDiff;
    const aActivity = a.lastActivityAt?.getTime() ?? 0;
    const bActivity = b.lastActivityAt?.getTime() ?? 0;
    const activityDiff = bActivity - aActivity;
    if (activityDiff !== 0) return activityDiff;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const filtered = rows.length;
  const pageCount = Math.max(1, Math.ceil(filtered / pageSize));
  const current = Math.min(requestedPage, pageCount);
  const start = (current - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return {
    learners: pageRows,
    counts: {
      active: activeLearnerCount,
      all: learnerCountAll,
      removed: Math.max(0, learnerCountAll - activeLearnerCount),
      filtered,
    },
    page: {
      current,
      pageSize,
      pageCount,
      rangeStart: filtered === 0 ? 0 : start + 1,
      rangeEnd: Math.min(start + pageSize, filtered),
    },
  };
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
    where: { email: { equals: email, mode: "insensitive" }, org_id: ctx.org_id },
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
