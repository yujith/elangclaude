// Learner home dashboard — the single read-side helper that powers
// `apps/web/app/(learner)/home/page.tsx`. Pure DB-touching logic; the
// Next page is a thin wrapper that runs requireOrgContext and calls
// this function.
//
// Every query goes through withOrg(ctx). The proxy injects
// `org_id = ctx.org_id` on tenant-scoped tables (Attempt, MockSession,
// QuotaUsage, User) and passes through for Organization. We never read
// user_id from request input — it always comes from ctx.user_id.

import { Prisma, type Section, type Track } from "@prisma/client";
import { withOrg, type OrgContext } from "./tenancy";

const RECENT_LIMIT = 10;

// Canonical mock sit-order. Duplicated from apps/web/lib/mock/constants.ts
// to keep @elc/db from depending back into the app. If you change one,
// change both.
const MOCK_SECTION_ORDER = [
  "Listening",
  "Reading",
  "Writing",
  "Speaking",
] as const satisfies readonly Section[];

export type SectionKey = "Reading" | "Listening" | "Writing" | "Speaking";

export type SectionStat = {
  latestBand: number | null;
  latestAt: Date | null;
  bestBand: number | null;
  attemptsCount: number;
  latestAttemptId: string | null;
};

export type ResumeAttempt = {
  id: string;
  section: Section;
  startedAt: Date;
};

export type ResumeMockSession = {
  id: string;
  startedAt: Date;
  currentSection: Section | null;
};

export type RecentAttempt = {
  id: string;
  section: Section;
  status: "Graded" | "Submitted" | "InProgress";
  submittedAt: Date | null;
  startedAt: Date;
  bandOverall: number | null;
};

export type LearnerDashboardData = {
  user: {
    name: string | null;
    email: string;
    ielts_track: Track;
  };
  org: {
    name: string;
    quota_daily: number;
  };
  quotaToday: {
    used: number;
    limit: number;
  };
  resume: {
    mockSession: ResumeMockSession | null;
    attempt: ResumeAttempt | null;
  };
  perSection: Record<SectionKey, SectionStat>;
  recent: RecentAttempt[];
};

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function emptySectionStat(): SectionStat {
  return {
    latestBand: null,
    latestAt: null,
    bestBand: null,
    attemptsCount: 0,
    latestAttemptId: null,
  };
}

function emptyPerSection(): Record<SectionKey, SectionStat> {
  return {
    Reading: emptySectionStat(),
    Listening: emptySectionStat(),
    Writing: emptySectionStat(),
    Speaking: emptySectionStat(),
  };
}

function decimalToNumber(d: Prisma.Decimal | number | null): number | null {
  if (d === null || d === undefined) return null;
  if (typeof d === "number") return d;
  return Number(d.toString());
}

export async function getLearnerDashboard(
  ctx: OrgContext,
  now: Date = new Date(),
): Promise<LearnerDashboardData> {
  const db = withOrg(ctx);
  const today = startOfUtcDay(now);

  const [
    user,
    org,
    quotaUsage,
    gradedAttempts,
    ungradedAttempts,
    recentAttempts,
    inProgressAttempt,
    inProgressMockSession,
  ] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: ctx.user_id },
      select: { name: true, email: true, ielts_track: true },
    }),
    db.organization.findUniqueOrThrow({
      where: { id: ctx.org_id },
      select: { name: true, quota_daily: true },
    }),
    // findFirst (not findUnique) because the compound unique key here is
    // (user_id, date) — the proxy still injects org_id, and uniqueness is
    // guaranteed by the @@unique on QuotaUsage.
    db.quotaUsage.findFirst({
      where: { user_id: ctx.user_id, date: today },
      select: { ai_calls_count: true },
    }),
    // Graded attempts power both per-section bands and recent list bands.
    // Pull once and project both ways below; cheaper than two queries.
    db.attempt.findMany({
      where: { user_id: ctx.user_id, status: "Graded" },
      select: {
        id: true,
        section: true,
        submitted_at: true,
        grade: { select: { band_overall: true } },
      },
      orderBy: { submitted_at: "desc" },
    }),
    // Submitted + InProgress per section (for attemptsCount). Abandoned
    // is intentionally excluded — those don't represent practice the
    // learner wants credit for.
    db.attempt.findMany({
      where: {
        user_id: ctx.user_id,
        status: { in: ["Submitted", "InProgress"] },
      },
      select: { id: true, section: true, status: true },
    }),
    db.attempt.findMany({
      where: {
        user_id: ctx.user_id,
        status: { in: ["Graded", "Submitted", "InProgress"] },
      },
      select: {
        id: true,
        section: true,
        status: true,
        submitted_at: true,
        started_at: true,
        grade: { select: { band_overall: true } },
      },
      orderBy: [
        { submitted_at: { sort: "desc", nulls: "last" } },
        { started_at: "desc" },
      ],
      take: RECENT_LIMIT,
    }),
    // Standalone InProgress attempts only (mock_session_id IS NULL).
    // The mock orchestrator owns mock-attached attempts; surfacing them
    // here would double-surface alongside the mock resume card.
    db.attempt.findFirst({
      where: {
        user_id: ctx.user_id,
        status: "InProgress",
        mock_session_id: null,
      },
      orderBy: { started_at: "desc" },
      select: { id: true, section: true, started_at: true },
    }),
    db.mockSession.findFirst({
      where: { user_id: ctx.user_id, status: "InProgress" },
      orderBy: { started_at: "desc" },
      select: {
        id: true,
        started_at: true,
        attempts: { select: { section: true, status: true } },
      },
    }),
  ]);

  // ── Per-section aggregates ────────────────────────────────────────────
  const perSection = emptyPerSection();

  // Graded first — graded attempts are ordered by submitted_at desc so
  // the first one we see for a section is the "latest".
  for (const a of gradedAttempts) {
    const key = a.section as SectionKey;
    const slot = perSection[key];
    const band = decimalToNumber(a.grade?.band_overall ?? null);
    slot.attemptsCount += 1;
    if (band !== null) {
      if (slot.bestBand === null || band > slot.bestBand) slot.bestBand = band;
      if (slot.latestBand === null) {
        slot.latestBand = band;
        slot.latestAt = a.submitted_at;
        slot.latestAttemptId = a.id;
      }
    }
  }
  for (const a of ungradedAttempts) {
    perSection[a.section as SectionKey].attemptsCount += 1;
  }

  // ── Recent list ───────────────────────────────────────────────────────
  const recent: RecentAttempt[] = recentAttempts.map((a) => ({
    id: a.id,
    section: a.section,
    status: a.status as RecentAttempt["status"],
    submittedAt: a.submitted_at,
    startedAt: a.started_at,
    bandOverall: decimalToNumber(a.grade?.band_overall ?? null),
  }));

  // ── Resume card sources ──────────────────────────────────────────────
  let mockResume: ResumeMockSession | null = null;
  if (inProgressMockSession) {
    const byStatus = new Map<Section, string>();
    for (const ma of inProgressMockSession.attempts) {
      const existing = byStatus.get(ma.section);
      if (!existing) {
        byStatus.set(ma.section, ma.status);
      } else {
        const rank = (s: string) =>
          s === "Graded"
            ? 3
            : s === "Submitted"
              ? 2
              : s === "InProgress"
                ? 1
                : 0;
        if (rank(ma.status) > rank(existing)) {
          byStatus.set(ma.section, ma.status);
        }
      }
    }
    let currentSection: Section | null = null;
    for (const s of MOCK_SECTION_ORDER) {
      const st = byStatus.get(s);
      if (!st || (st !== "Graded" && st !== "Abandoned")) {
        currentSection = s;
        break;
      }
    }
    mockResume = {
      id: inProgressMockSession.id,
      startedAt: inProgressMockSession.started_at,
      currentSection,
    };
  }

  const attemptResume: ResumeAttempt | null = inProgressAttempt
    ? {
        id: inProgressAttempt.id,
        section: inProgressAttempt.section,
        startedAt: inProgressAttempt.started_at,
      }
    : null;

  return {
    user,
    org,
    quotaToday: {
      used: quotaUsage?.ai_calls_count ?? 0,
      limit: org.quota_daily,
    },
    resume: {
      mockSession: mockResume,
      attempt: attemptResume,
    },
    perSection,
    recent,
  };
}
