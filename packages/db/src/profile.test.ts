import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { hasInProgressWork, updateMyIeltsTrack } from "./profile";
import type { OrgContext } from "./tenancy";
import { createTestOrg, resetDatabase } from "./test-helpers";

beforeEach(async () => {
  await resetDatabase();
});

function learnerCtx(org: { id: string; learnerIds: string[] }): OrgContext {
  return { org_id: org.id, user_id: org.learnerIds[0]!, role: "Learner" };
}

async function createApprovedTest(): Promise<string> {
  const t = await prisma.test.create({
    data: {
      track: "Academic",
      section: "Reading",
      difficulty: 5,
      status: "Approved",
    },
  });
  return t.id;
}

describe("updateMyIeltsTrack", () => {
  it("flips the caller's track and writes a profile.track_changed log", async () => {
    const org = await createTestOrg("A");
    const ctx = learnerCtx(org);

    const before = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.user_id },
      select: { ielts_track: true },
    });
    expect(before.ielts_track).toBe("Academic");

    const result = await updateMyIeltsTrack(ctx, { ielts_track: "GeneralTraining" });
    expect(result).toEqual({
      ok: true,
      ielts_track: "GeneralTraining",
      changed: true,
    });

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.user_id },
      select: { ielts_track: true },
    });
    expect(after.ielts_track).toBe("GeneralTraining");

    const log = await prisma.activityLog.findFirst({
      where: { org_id: org.id, action: "profile.track_changed" },
      orderBy: { timestamp: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log?.user_id).toBe(ctx.user_id);
    expect(log?.metadata).toMatchObject({ from: "Academic", to: "GeneralTraining" });
  });

  it("no-ops with changed=false when the track is already set", async () => {
    const org = await createTestOrg("B");
    const ctx = learnerCtx(org);

    const result = await updateMyIeltsTrack(ctx, { ielts_track: "Academic" });
    expect(result).toEqual({
      ok: true,
      ielts_track: "Academic",
      changed: false,
    });

    const logs = await prisma.activityLog.findMany({
      where: { org_id: org.id, action: "profile.track_changed" },
    });
    expect(logs).toHaveLength(0);
  });

  it("rejects invalid track values", async () => {
    const org = await createTestOrg("C");
    const ctx = learnerCtx(org);

    const result = await updateMyIeltsTrack(ctx, {
      ielts_track: "Recreational" as unknown as "Academic",
    });
    expect(result).toEqual({ ok: false, reason: "invalid_track" });
  });

  it("refuses to switch when an in-progress Attempt exists", async () => {
    const org = await createTestOrg("D");
    const ctx = learnerCtx(org);
    const testId = await createApprovedTest();

    await prisma.attempt.create({
      data: {
        org_id: org.id,
        user_id: ctx.user_id,
        test_id: testId,
        section: "Reading",
        status: "InProgress",
      },
    });

    const result = await updateMyIeltsTrack(ctx, { ielts_track: "GeneralTraining" });
    expect(result).toEqual({ ok: false, reason: "in_progress_work" });

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.user_id },
      select: { ielts_track: true },
    });
    expect(row.ielts_track).toBe("Academic");
  });

  it("refuses to switch when an in-progress MockSession exists", async () => {
    const org = await createTestOrg("E");
    const ctx = learnerCtx(org);

    await prisma.mockSession.create({
      data: {
        org_id: org.id,
        user_id: ctx.user_id,
        track: "Academic",
        status: "InProgress",
      },
    });

    const result = await updateMyIeltsTrack(ctx, { ielts_track: "GeneralTraining" });
    expect(result).toEqual({ ok: false, reason: "in_progress_work" });
  });

  it("a submitted attempt does not block the switch", async () => {
    const org = await createTestOrg("F");
    const ctx = learnerCtx(org);
    const testId = await createApprovedTest();

    await prisma.attempt.create({
      data: {
        org_id: org.id,
        user_id: ctx.user_id,
        test_id: testId,
        section: "Reading",
        status: "Submitted",
        submitted_at: new Date(),
      },
    });

    const result = await updateMyIeltsTrack(ctx, { ielts_track: "GeneralTraining" });
    expect(result.ok).toBe(true);
  });

  it("does not touch another org's user row even with a crafted ctx", async () => {
    const orgA = await createTestOrg("G1");
    const orgB = await createTestOrg("G2");

    const userBId = orgB.learnerIds[0]!;
    const userBBefore = await prisma.user.findUniqueOrThrow({
      where: { id: userBId },
      select: { ielts_track: true },
    });

    // Craft a ctx that points at orgA but smuggles userB's id into user_id.
    // withOrg(ctx) filters by org_id, so the findUnique will miss userB and
    // the helper returns invalid_track. The important assertion is that
    // userB's row is untouched.
    const craftedCtx: OrgContext = {
      org_id: orgA.id,
      user_id: userBId,
      role: "Learner",
    };

    const result = await updateMyIeltsTrack(craftedCtx, {
      ielts_track: "GeneralTraining",
    });
    expect(result.ok).toBe(false);

    const userBAfter = await prisma.user.findUniqueOrThrow({
      where: { id: userBId },
      select: { ielts_track: true },
    });
    expect(userBAfter.ielts_track).toBe(userBBefore.ielts_track);

    const logs = await prisma.activityLog.findMany({
      where: { action: "profile.track_changed" },
    });
    expect(logs).toHaveLength(0);
  });
});

describe("hasInProgressWork", () => {
  it("returns false when nothing is in progress", async () => {
    const org = await createTestOrg("H");
    const ctx = learnerCtx(org);
    expect(await hasInProgressWork(ctx)).toBe(false);
  });

  it("returns true with an in-progress Attempt", async () => {
    const org = await createTestOrg("I");
    const ctx = learnerCtx(org);
    const testId = await createApprovedTest();
    await prisma.attempt.create({
      data: {
        org_id: org.id,
        user_id: ctx.user_id,
        test_id: testId,
        section: "Reading",
        status: "InProgress",
      },
    });
    expect(await hasInProgressWork(ctx)).toBe(true);
  });

  it("returns true with an in-progress MockSession", async () => {
    const org = await createTestOrg("J");
    const ctx = learnerCtx(org);
    await prisma.mockSession.create({
      data: {
        org_id: org.id,
        user_id: ctx.user_id,
        track: "Academic",
        status: "InProgress",
      },
    });
    expect(await hasInProgressWork(ctx)).toBe(true);
  });
});
