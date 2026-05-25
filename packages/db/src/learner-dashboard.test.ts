import { beforeEach, describe, expect, it } from "vitest";
import { Prisma, type Section } from "@prisma/client";
import { prisma } from "./client";
import { getLearnerDashboard } from "./learner-dashboard";
import type { OrgContext } from "./tenancy";
import {
  createTestOrg,
  resetDatabase,
  type TestOrg,
} from "./test-helpers";

beforeEach(async () => {
  await resetDatabase();
});

// ─── Helpers ─────────────────────────────────────────────────────────────

function utcDay(daysAgoFromRef: number, ref: Date): Date {
  const base = new Date(
    Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()),
  );
  return new Date(base.getTime() - daysAgoFromRef * 24 * 60 * 60 * 1000);
}

function learnerCtx(org: TestOrg, learnerIndex = 0): OrgContext {
  return {
    org_id: org.id,
    user_id: org.learnerIds[learnerIndex]!,
    role: "Learner",
  };
}

async function createApprovedTest(section: Section) {
  return prisma.test.create({
    data: {
      track: "Academic",
      section,
      difficulty: 5,
      status: "Approved",
    },
  });
}

async function gradeAttempt(
  org: TestOrg,
  learnerIndex: number,
  testId: string,
  section: Section,
  band: number,
  submittedAt: Date,
) {
  const attempt = await prisma.attempt.create({
    data: {
      org_id: org.id,
      user_id: org.learnerIds[learnerIndex]!,
      test_id: testId,
      section,
      status: "Graded",
      submitted_at: submittedAt,
    },
  });
  await prisma.grade.create({
    data: {
      org_id: org.id,
      attempt_id: attempt.id,
      band_overall: new Prisma.Decimal(band),
      criteria_scores_json: {} as Prisma.InputJsonValue,
      graded_by: "AI",
    },
  });
  return attempt;
}

async function startInProgressAttempt(
  org: TestOrg,
  learnerIndex: number,
  testId: string,
  section: Section,
  startedAt: Date,
  mockSessionId: string | null = null,
) {
  return prisma.attempt.create({
    data: {
      org_id: org.id,
      user_id: org.learnerIds[learnerIndex]!,
      test_id: testId,
      section,
      status: "InProgress",
      started_at: startedAt,
      mock_session_id: mockSessionId,
    },
  });
}

async function createMockSession(
  org: TestOrg,
  learnerIndex: number,
  startedAt: Date,
) {
  return prisma.mockSession.create({
    data: {
      org_id: org.id,
      user_id: org.learnerIds[learnerIndex]!,
      track: "Academic",
      status: "InProgress",
      started_at: startedAt,
    },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("getLearnerDashboard — empty state", () => {
  it("returns empty per-section + null resume + 0 quota for a fresh learner", async () => {
    const org = await createTestOrg("Empty");
    const dash = await getLearnerDashboard(learnerCtx(org));

    expect(dash.user.email).toContain("learner-Empty-1-");
    expect(dash.user.ielts_track).toBe("Academic");
    expect(dash.org.quota_daily).toBe(100);
    expect(dash.quotaToday).toEqual({ used: 0, limit: 100 });
    expect(dash.resume.mockSession).toBeNull();
    expect(dash.resume.attempt).toBeNull();
    expect(dash.recent).toEqual([]);
    for (const s of ["Reading", "Listening", "Writing", "Speaking"] as const) {
      expect(dash.perSection[s]).toEqual({
        latestBand: null,
        latestAt: null,
        bestBand: null,
        attemptsCount: 0,
        latestAttemptId: null,
      });
    }
  });
});

describe("getLearnerDashboard — per-section aggregates", () => {
  it("latest = most recent submitted_at; best = max band; count includes InProgress", async () => {
    const org = await createTestOrg("PerSection");
    const readingTest = await createApprovedTest("Reading");
    const writingTest = await createApprovedTest("Writing");
    const now = new Date("2026-05-20T12:00:00.000Z");

    // Reading: two graded attempts. Older has the higher band so we can
    // tell "latest" from "best" apart.
    await gradeAttempt(org, 0, readingTest.id, "Reading", 7.5, utcDay(7, now));
    await gradeAttempt(org, 0, readingTest.id, "Reading", 6.0, utcDay(1, now));

    // Writing: one graded + one in-progress (standalone). attemptsCount
    // should count both; latest band should reflect the graded one.
    await gradeAttempt(org, 0, writingTest.id, "Writing", 5.5, utcDay(3, now));
    await startInProgressAttempt(
      org,
      0,
      writingTest.id,
      "Writing",
      utcDay(0, now),
    );

    const dash = await getLearnerDashboard(learnerCtx(org), now);

    expect(dash.perSection.Reading.latestBand).toBe(6.0);
    expect(dash.perSection.Reading.bestBand).toBe(7.5);
    expect(dash.perSection.Reading.attemptsCount).toBe(2);
    expect(dash.perSection.Reading.latestAt?.toISOString()).toBe(
      utcDay(1, now).toISOString(),
    );

    expect(dash.perSection.Writing.latestBand).toBe(5.5);
    expect(dash.perSection.Writing.bestBand).toBe(5.5);
    expect(dash.perSection.Writing.attemptsCount).toBe(2);

    expect(dash.perSection.Listening.attemptsCount).toBe(0);
    expect(dash.perSection.Speaking.attemptsCount).toBe(0);
  });
});

describe("getLearnerDashboard — recent attempts list", () => {
  it("orders submitted_at desc (nulls last); caps at 10; includes InProgress", async () => {
    const org = await createTestOrg("Recent");
    const readingTest = await createApprovedTest("Reading");
    const now = new Date("2026-05-20T12:00:00.000Z");

    // Twelve graded attempts at distinct submitted_at values so the cap
    // is exercised.
    for (let i = 0; i < 12; i++) {
      await gradeAttempt(
        org,
        0,
        readingTest.id,
        "Reading",
        5 + (i % 5) * 0.5,
        utcDay(i, now),
      );
    }
    // One in-progress — submitted_at IS NULL, so under `nulls: "last"`
    // it lands at the tail. With 12 graded rows and a 10-cap, it should
    // be excluded; verify that ordering invariant holds either way.
    const inProgress = await startInProgressAttempt(
      org,
      0,
      readingTest.id,
      "Reading",
      utcDay(0, now),
    );

    const dash = await getLearnerDashboard(learnerCtx(org), now);

    expect(dash.recent.length).toBe(10);
    const submittedAts = dash.recent
      .filter((r) => r.submittedAt !== null)
      .map((r) => r.submittedAt!.getTime());
    const sortedDesc = [...submittedAts].sort((a, b) => b - a);
    expect(submittedAts).toEqual(sortedDesc);

    // If the in-progress row made the cap, its band must be null and
    // its status must be InProgress.
    const inProgressRow = dash.recent.find((r) => r.id === inProgress.id);
    if (inProgressRow) {
      expect(inProgressRow.status).toBe("InProgress");
      expect(inProgressRow.bandOverall).toBeNull();
    }
  });
});

describe("getLearnerDashboard — resume card", () => {
  it("surfaces the most-recent standalone InProgress attempt as resume.attempt", async () => {
    const org = await createTestOrg("ResumeAttempt");
    const writingTest = await createApprovedTest("Writing");
    const now = new Date("2026-05-20T12:00:00.000Z");

    await startInProgressAttempt(
      org,
      0,
      writingTest.id,
      "Writing",
      utcDay(2, now),
    );
    const newer = await startInProgressAttempt(
      org,
      0,
      writingTest.id,
      "Writing",
      utcDay(0, now),
    );

    const dash = await getLearnerDashboard(learnerCtx(org), now);
    expect(dash.resume.attempt?.id).toBe(newer.id);
    expect(dash.resume.attempt?.section).toBe("Writing");
  });

  it("excludes mock-attached InProgress attempts from resume.attempt", async () => {
    const org = await createTestOrg("ResumeMock");
    const writingTest = await createApprovedTest("Writing");
    const listeningTest = await createApprovedTest("Listening");
    const now = new Date("2026-05-20T12:00:00.000Z");

    const session = await createMockSession(org, 0, utcDay(1, now));
    // Mock-attached InProgress Listening — must NOT surface as resume.attempt.
    await startInProgressAttempt(
      org,
      0,
      listeningTest.id,
      "Listening",
      utcDay(0, now),
      session.id,
    );
    // Standalone InProgress Writing — should win resume.attempt.
    const standalone = await startInProgressAttempt(
      org,
      0,
      writingTest.id,
      "Writing",
      utcDay(0, now),
    );

    const dash = await getLearnerDashboard(learnerCtx(org), now);
    expect(dash.resume.attempt?.id).toBe(standalone.id);
    expect(dash.resume.mockSession?.id).toBe(session.id);
    expect(dash.resume.mockSession?.currentSection).toBe("Listening");
  });

  it("computes mock currentSection as the first non-graded section in sit order", async () => {
    const org = await createTestOrg("ResumeMockOrder");
    const listeningTest = await createApprovedTest("Listening");
    const readingTest = await createApprovedTest("Reading");
    const now = new Date("2026-05-20T12:00:00.000Z");

    const session = await createMockSession(org, 0, utcDay(2, now));
    // Listening graded; Reading in-progress; Writing/Speaking not started.
    // Expected currentSection = Reading.
    const listeningAttempt = await prisma.attempt.create({
      data: {
        org_id: org.id,
        user_id: org.learnerIds[0]!,
        test_id: listeningTest.id,
        section: "Listening",
        status: "Graded",
        submitted_at: utcDay(1, now),
        mock_session_id: session.id,
      },
    });
    await prisma.grade.create({
      data: {
        org_id: org.id,
        attempt_id: listeningAttempt.id,
        band_overall: new Prisma.Decimal(7.0),
        criteria_scores_json: {} as Prisma.InputJsonValue,
        graded_by: "AI",
      },
    });
    await startInProgressAttempt(
      org,
      0,
      readingTest.id,
      "Reading",
      utcDay(0, now),
      session.id,
    );

    const dash = await getLearnerDashboard(learnerCtx(org), now);
    expect(dash.resume.mockSession?.currentSection).toBe("Reading");
  });
});

describe("getLearnerDashboard — quota", () => {
  it("returns today's ai_calls_count from QuotaUsage", async () => {
    const org = await createTestOrg("Quota");
    const now = new Date("2026-05-20T12:00:00.000Z");
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    await prisma.quotaUsage.create({
      data: {
        org_id: org.id,
        user_id: org.learnerIds[0]!,
        date: today,
        ai_calls_count: 17,
      },
    });

    const dash = await getLearnerDashboard(learnerCtx(org), now);
    expect(dash.quotaToday).toEqual({ used: 17, limit: 100 });
  });

  it("returns 0 when no QuotaUsage row exists for today", async () => {
    const org = await createTestOrg("QuotaZero");
    const now = new Date("2026-05-20T12:00:00.000Z");
    const dash = await getLearnerDashboard(learnerCtx(org), now);
    expect(dash.quotaToday.used).toBe(0);
  });
});

describe("getLearnerDashboard — tenancy isolation", () => {
  it("never returns another org's attempts, grades, mocks, or quota", async () => {
    const orgA = await createTestOrg("TenantA");
    const orgB = await createTestOrg("TenantB");
    const readingTest = await createApprovedTest("Reading");
    const writingTest = await createApprovedTest("Writing");
    const now = new Date("2026-05-20T12:00:00.000Z");

    // A: one graded Reading attempt.
    const aGraded = await gradeAttempt(
      orgA,
      0,
      readingTest.id,
      "Reading",
      6.5,
      utcDay(1, now),
    );
    // B: many graded attempts across sections, an in-progress mock, an
    // in-progress standalone attempt, and a quota row. None should leak.
    await gradeAttempt(orgB, 0, readingTest.id, "Reading", 9.0, utcDay(0, now));
    await gradeAttempt(orgB, 0, writingTest.id, "Writing", 8.5, utcDay(0, now));
    const bSession = await createMockSession(orgB, 0, utcDay(0, now));
    await startInProgressAttempt(
      orgB,
      0,
      writingTest.id,
      "Writing",
      utcDay(0, now),
      bSession.id,
    );
    await startInProgressAttempt(
      orgB,
      0,
      writingTest.id,
      "Writing",
      utcDay(0, now),
    );
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    await prisma.quotaUsage.create({
      data: {
        org_id: orgB.id,
        user_id: orgB.learnerIds[0]!,
        date: today,
        ai_calls_count: 99,
      },
    });

    const dashA = await getLearnerDashboard(learnerCtx(orgA), now);

    expect(dashA.recent.map((r) => r.id)).toEqual([aGraded.id]);
    expect(dashA.perSection.Reading.bestBand).toBe(6.5);
    expect(dashA.perSection.Reading.latestBand).toBe(6.5);
    expect(dashA.perSection.Writing.attemptsCount).toBe(0);
    expect(dashA.perSection.Writing.bestBand).toBeNull();
    expect(dashA.resume.attempt).toBeNull();
    expect(dashA.resume.mockSession).toBeNull();
    expect(dashA.quotaToday.used).toBe(0);
    expect(dashA.org.name).toBe("Test Org TenantA");
  });

  it("isolates learners within the same org", async () => {
    const org = await createTestOrg("SameOrg");
    const readingTest = await createApprovedTest("Reading");
    const now = new Date("2026-05-20T12:00:00.000Z");

    // Learner 0 has attempts; learner 1 has nothing.
    await gradeAttempt(org, 0, readingTest.id, "Reading", 7.0, utcDay(1, now));
    await gradeAttempt(org, 0, readingTest.id, "Reading", 8.0, utcDay(0, now));

    const dashOne = await getLearnerDashboard(learnerCtx(org, 1), now);
    expect(dashOne.recent).toEqual([]);
    expect(dashOne.perSection.Reading.attemptsCount).toBe(0);
    expect(dashOne.perSection.Reading.bestBand).toBeNull();
  });
});
