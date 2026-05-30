import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import {
  loadOrgLearnerRoster,
  softDeleteLearnerForOrg,
  updateLearnerForOrg,
} from "./org-learner-admin";
import { withOrg } from "./tenancy";
import { createTestOrg, ctxFor, resetDatabase } from "./test-helpers";

beforeEach(async () => {
  await resetDatabase();
});

const NOW = new Date("2026-05-26T12:00:00.000Z");

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

async function seedRosterAttempt(input: {
  orgId: string;
  learnerId: string;
  testId: string;
  section?: "Reading" | "Listening" | "Writing" | "Speaking";
  status?: "InProgress" | "Submitted" | "Graded";
  startedAt: Date;
  submittedAt?: Date | null;
  band?: string;
}) {
  const attempt = await prisma.attempt.create({
    data: {
      org_id: input.orgId,
      user_id: input.learnerId,
      test_id: input.testId,
      section: input.section ?? "Reading",
      status: input.status ?? (input.band ? "Graded" : "Submitted"),
      started_at: input.startedAt,
      submitted_at: input.submittedAt ?? input.startedAt,
    },
  });
  if (input.band) {
    await prisma.grade.create({
      data: {
        org_id: input.orgId,
        attempt_id: attempt.id,
        band_overall: input.band,
        criteria_scores_json: {},
        graded_at: input.submittedAt ?? input.startedAt,
      },
    });
  }
  return attempt;
}

describe("loadOrgLearnerRoster", () => {
  it("rolls up learner usage, activity, latest band, and default usage-first ordering", async () => {
    const org = await createTestOrg("RosterA");
    const ctx = ctxFor(org);
    const [highId, inactiveId, steadyId] = org.learnerIds;
    await prisma.user.update({
      where: { id: highId! },
      data: { name: "High Usage", createdAt: new Date("2026-01-01T00:00:00.000Z") },
    });
    await prisma.user.update({
      where: { id: steadyId! },
      data: { name: "Steady Usage", createdAt: new Date("2026-01-03T00:00:00.000Z") },
    });
    await prisma.user.update({
      where: { id: inactiveId! },
      data: { name: "Inactive Usage", createdAt: new Date("2026-01-02T00:00:00.000Z") },
    });
    await prisma.quotaUsage.createMany({
      data: [
        { org_id: org.id, user_id: highId!, date: day("2026-05-26"), ai_calls_count: 4 },
        { org_id: org.id, user_id: highId!, date: day("2026-05-25"), ai_calls_count: 6 },
        { org_id: org.id, user_id: highId!, date: day("2026-05-01"), ai_calls_count: 7 },
        { org_id: org.id, user_id: steadyId!, date: day("2026-05-26"), ai_calls_count: 2 },
        { org_id: org.id, user_id: steadyId!, date: day("2026-05-10"), ai_calls_count: 9 },
      ],
    });
    const test = await prisma.test.create({
      data: {
        track: "Academic",
        section: "Reading",
        difficulty: 5,
        status: "Approved",
      },
    });
    await seedRosterAttempt({
      orgId: org.id,
      learnerId: highId!,
      testId: test.id,
      startedAt: new Date("2026-05-25T10:00:00.000Z"),
      submittedAt: new Date("2026-05-25T11:00:00.000Z"),
      band: "6.5",
    });
    await seedRosterAttempt({
      orgId: org.id,
      learnerId: highId!,
      testId: test.id,
      startedAt: new Date("2026-05-26T09:00:00.000Z"),
      submittedAt: new Date("2026-05-26T10:00:00.000Z"),
      band: "7.0",
    });
    await seedRosterAttempt({
      orgId: org.id,
      learnerId: steadyId!,
      testId: test.id,
      startedAt: new Date("2026-05-10T09:00:00.000Z"),
      submittedAt: new Date("2026-05-10T10:00:00.000Z"),
    });

    const roster = await loadOrgLearnerRoster(ctx, {}, NOW);

    expect(roster.counts).toMatchObject({
      active: 3,
      all: 3,
      removed: 0,
      filtered: 3,
    });
    expect(roster.learners.map((l) => l.id)).toEqual([
      highId,
      steadyId,
      inactiveId,
    ]);
    expect(roster.learners[0]).toMatchObject({
      id: highId,
      callsToday: 4,
      callsWeek: 10,
      callsMonth: 17,
      attemptsCount: 2,
      latestBand: 7,
      lastActivityAt: new Date("2026-05-26T10:00:00.000Z"),
    });
    expect(roster.learners[1]).toMatchObject({
      id: steadyId,
      callsToday: 2,
      callsWeek: 2,
      callsMonth: 11,
      attemptsCount: 1,
      latestBand: null,
    });
    expect(roster.learners[2]).toMatchObject({
      id: inactiveId,
      callsToday: 0,
      callsWeek: 0,
      callsMonth: 0,
      attemptsCount: 0,
      latestBand: null,
      lastActivityAt: null,
    });
  });

  it("applies search, track, activity, inactivity, min-calls, and pagination filters", async () => {
    const org = await createTestOrg("RosterB");
    const ctx = ctxFor(org);
    const [academicActive, gtInactive, academicQuiet] = org.learnerIds;
    await prisma.user.update({
      where: { id: academicActive! },
      data: {
        email: "active-academic@elc.test",
        name: "Active Academic",
        ielts_track: "Academic",
      },
    });
    await prisma.user.update({
      where: { id: gtInactive! },
      data: {
        email: "inactive-gt@elc.test",
        name: "Inactive GT",
        ielts_track: "GeneralTraining",
      },
    });
    await prisma.user.update({
      where: { id: academicQuiet! },
      data: {
        email: "quiet-academic@elc.test",
        name: "Quiet Academic",
        ielts_track: "Academic",
      },
    });
    await prisma.quotaUsage.createMany({
      data: [
        { org_id: org.id, user_id: academicActive!, date: day("2026-05-26"), ai_calls_count: 5 },
        { org_id: org.id, user_id: academicQuiet!, date: day("2026-05-01"), ai_calls_count: 3 },
      ],
    });
    const test = await prisma.test.create({
      data: {
        track: "Academic",
        section: "Reading",
        difficulty: 5,
        status: "Approved",
      },
    });
    await seedRosterAttempt({
      orgId: org.id,
      learnerId: academicActive!,
      testId: test.id,
      startedAt: new Date("2026-05-26T08:00:00.000Z"),
    });
    await seedRosterAttempt({
      orgId: org.id,
      learnerId: gtInactive!,
      testId: test.id,
      startedAt: new Date("2026-04-20T08:00:00.000Z"),
    });

    const activeAcademic = await loadOrgLearnerRoster(
      ctx,
      { track: "Academic", activity: "today", minCalls: 4 },
      NOW,
    );
    expect(activeAcademic.learners.map((l) => l.id)).toEqual([academicActive]);

    const inactiveMonth = await loadOrgLearnerRoster(
      ctx,
      { inactive: "month" },
      NOW,
    );
    expect(inactiveMonth.learners.map((l) => l.id).sort()).toEqual(
      [gtInactive, academicQuiet].sort(),
    );

    const searched = await loadOrgLearnerRoster(ctx, { q: "quiet" }, NOW);
    expect(searched.learners.map((l) => l.id)).toEqual([academicQuiet]);

    const paged = await loadOrgLearnerRoster(ctx, { pageSize: 1, page: 2 }, NOW);
    expect(paged.page).toMatchObject({
      current: 2,
      pageSize: 1,
      pageCount: 3,
      rangeStart: 2,
      rangeEnd: 2,
    });
    expect(paged.learners).toHaveLength(1);
  });

  it("keeps the roster scoped to the org context", async () => {
    const orgA = await createTestOrg("RosterC1");
    const orgB = await createTestOrg("RosterC2");
    await prisma.quotaUsage.create({
      data: {
        org_id: orgB.id,
        user_id: orgB.learnerIds[0]!,
        date: day("2026-05-26"),
        ai_calls_count: 99,
      },
    });

    const roster = await loadOrgLearnerRoster(ctxFor(orgA), {}, NOW);

    expect(roster.counts.active).toBe(3);
    expect(roster.learners).toHaveLength(3);
    expect(roster.learners.every((l) => orgA.learnerIds.includes(l.id))).toBe(
      true,
    );
    expect(roster.learners.every((l) => l.callsToday === 0)).toBe(true);
  });
});

describe("updateLearnerForOrg", () => {
  it("updates a same-org learner's email, name, and track and logs the change", async () => {
    const org = await createTestOrg("A");
    const ctx = ctxFor(org);
    const learnerId = org.learnerIds[0]!;

    const result = await updateLearnerForOrg(ctx, {
      user_id: learnerId,
      email: "updated@elc.test",
      name: "Updated Learner",
      ielts_track: "GeneralTraining",
    });
    expect(result).toEqual({ ok: true, user_id: learnerId, changed: true });

    const learner = await prisma.user.findUnique({
      where: { id: learnerId },
      select: { email: true, name: true, ielts_track: true },
    });
    expect(learner).toMatchObject({
      email: "updated@elc.test",
      name: "Updated Learner",
      ielts_track: "GeneralTraining",
    });

    const log = await prisma.activityLog.findFirst({
      where: { org_id: org.id, action: "learner.updated" },
      orderBy: { timestamp: "desc" },
    });
    expect(log).not.toBeNull();
  });

  it("returns changed=false and skips the log on a no-op edit", async () => {
    const org = await createTestOrg("B");
    const ctx = ctxFor(org);
    const learner = await prisma.user.findUniqueOrThrow({
      where: { id: org.learnerIds[0]! },
      select: { id: true, email: true, name: true, ielts_track: true },
    });

    const result = await updateLearnerForOrg(ctx, {
      user_id: learner.id,
      email: learner.email,
      name: learner.name,
      ielts_track: learner.ielts_track,
    });
    expect(result).toEqual({ ok: true, user_id: learner.id, changed: false });

    const logs = await prisma.activityLog.findMany({
      where: { org_id: org.id, action: "learner.updated" },
    });
    expect(logs).toHaveLength(0);
  });

  it("rejects malformed emails", async () => {
    const org = await createTestOrg("C");
    const result = await updateLearnerForOrg(ctxFor(org), {
      user_id: org.learnerIds[0]!,
      email: "bad-email",
      name: "Nope",
      ielts_track: "Academic",
    });
    expect(result).toEqual({ ok: false, reason: "invalid_email" });
  });

  it("refuses to use an email already claimed elsewhere", async () => {
    const orgA = await createTestOrg("D1");
    const orgB = await createTestOrg("D2");
    const claimed = await prisma.user.findUniqueOrThrow({
      where: { id: orgB.learnerIds[0]! },
      select: { email: true },
    });

    const result = await updateLearnerForOrg(ctxFor(orgA), {
      user_id: orgA.learnerIds[0]!,
      email: claimed.email,
      name: "Collision",
      ielts_track: "Academic",
    });
    expect(result).toEqual({ ok: false, reason: "cannot_use_email" });
  });

  it("refuses to act on a same-org non-learner", async () => {
    const org = await createTestOrg("E");
    const result = await updateLearnerForOrg(ctxFor(org), {
      user_id: org.adminId,
      email: "admin-edit@elc.test",
      name: "Should Fail",
      ielts_track: "Academic",
    });
    expect(result).toEqual({ ok: false, reason: "learner_not_found" });
  });

  it("refuses to edit a soft-deleted learner", async () => {
    const org = await createTestOrg("F");
    const learnerId = org.learnerIds[0]!;
    await prisma.user.update({
      where: { id: learnerId },
      data: { deleted_at: new Date() },
    });

    const result = await updateLearnerForOrg(ctxFor(org), {
      user_id: learnerId,
      email: "removed@elc.test",
      name: "Removed",
      ielts_track: "Academic",
    });
    expect(result).toEqual({ ok: false, reason: "learner_deleted" });
  });
});

describe("softDeleteLearnerForOrg", () => {
  it("soft-deletes a same-org learner, hides them from the roster, and logs the removal", async () => {
    const org = await createTestOrg("G");
    const ctx = ctxFor(org);
    const learnerId = org.learnerIds[0]!;

    const result = await softDeleteLearnerForOrg(ctx, { user_id: learnerId });
    expect(result).toEqual({ ok: true, user_id: learnerId });

    const roster = await withOrg(ctx).user.findMany({
      where: { role: "Learner", deleted_at: null },
      select: { id: true },
    });
    expect(roster.some((u) => u.id === learnerId)).toBe(false);

    const row = await prisma.user.findUnique({
      where: { id: learnerId },
      select: { deleted_at: true },
    });
    expect(row?.deleted_at).not.toBeNull();

    const log = await prisma.activityLog.findFirst({
      where: { org_id: org.id, action: "learner.removed" },
      orderBy: { timestamp: "desc" },
    });
    expect(log).not.toBeNull();
  });

  it("is idempotent for an already-removed learner", async () => {
    const org = await createTestOrg("H");
    const learnerId = org.learnerIds[0]!;
    const deletedAt = new Date("2020-01-01T00:00:00.000Z");
    await prisma.user.update({
      where: { id: learnerId },
      data: { deleted_at: deletedAt },
    });

    const result = await softDeleteLearnerForOrg(ctxFor(org), {
      user_id: learnerId,
    });
    expect(result).toEqual({ ok: true, user_id: learnerId });

    const row = await prisma.user.findUnique({
      where: { id: learnerId },
      select: { deleted_at: true },
    });
    expect(row?.deleted_at?.toISOString()).toBe(deletedAt.toISOString());
  });

  it("refuses to remove a same-org non-learner", async () => {
    const org = await createTestOrg("I");
    const result = await softDeleteLearnerForOrg(ctxFor(org), {
      user_id: org.adminId,
    });
    expect(result).toEqual({ ok: false, reason: "learner_not_found" });
  });
});
