import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import {
  softDeleteLearnerForOrg,
  updateLearnerForOrg,
} from "./org-learner-admin";
import { withOrg } from "./tenancy";
import { createTestOrg, ctxFor, resetDatabase } from "./test-helpers";

beforeEach(async () => {
  await resetDatabase();
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
