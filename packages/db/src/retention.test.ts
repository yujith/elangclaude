import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { recordConsent } from "./consent";
import { requestErasure } from "./data-rights";
import { processPendingErasures, purgeExpiredRecordings } from "./retention";
import { type OrgContext } from "./tenancy";
import { createTestOrg, resetDatabase, seedActivity, type TestOrg } from "./test-helpers";

beforeEach(async () => {
  await resetDatabase();
});

function learnerCtx(org: TestOrg, idx = 0): OrgContext {
  return { org_id: org.id, user_id: org.learnerIds[idx]!, role: "Learner" };
}

const DAY = 24 * 60 * 60 * 1000;

async function makeRecording(org: TestOrg, attemptId: string, createdAt: Date, key: string) {
  await prisma.recording.create({
    data: {
      org_id: org.id,
      attempt_id: attemptId,
      storage_url: key,
      duration_sec: 120,
      createdAt,
    },
  });
}

describe("purgeExpiredRecordings", () => {
  it("deletes recordings past the window and keeps fresh ones", async () => {
    const org = await createTestOrg("A");
    const { attemptIds } = await seedActivity(org, 1);
    const now = new Date("2026-06-01T00:00:00Z");

    await makeRecording(org, attemptIds[0]!, new Date(now.getTime() - 100 * DAY), "old.webm");
    await makeRecording(org, attemptIds[1]!, new Date(now.getTime() - 10 * DAY), "fresh.webm");

    const deleted: string[] = [];
    const result = await purgeExpiredRecordings({
      now,
      retentionDays: 90,
      deleteObject: async (k) => {
        deleted.push(k);
      },
    });

    expect(result.deleted).toBe(1);
    expect(deleted).toEqual(["old.webm"]);
    const remaining = await prisma.recording.findMany({ select: { storage_url: true } });
    expect(remaining.map((r) => r.storage_url)).toEqual(["fresh.webm"]);
  });

  it("is idempotent — a second run deletes nothing", async () => {
    const org = await createTestOrg("A");
    const { attemptIds } = await seedActivity(org, 1);
    const now = new Date("2026-06-01T00:00:00Z");
    await makeRecording(org, attemptIds[0]!, new Date(now.getTime() - 100 * DAY), "old.webm");

    await purgeExpiredRecordings({ now, retentionDays: 90 });
    const second = await purgeExpiredRecordings({ now, retentionDays: 90 });
    expect(second.deleted).toBe(0);
  });
});

describe("processPendingErasures", () => {
  it("scrubs the subject after the grace period and deletes their content", async () => {
    const org = await createTestOrg("A");
    const { attemptIds } = await seedActivity(org, 1);
    const ctx = learnerCtx(org, 0);
    const learnerAttempts = await prisma.attempt.findMany({
      where: { user_id: ctx.user_id },
      select: { id: true },
    });
    await makeRecording(org, learnerAttempts[0]!.id, new Date(), "voice.webm");
    await recordConsent(ctx, {
      consent_type: "terms_privacy",
      granted: true,
      policy_version: "v1",
      source: "signup",
    });
    await requestErasure(ctx);
    // Backdate the request past the grace period.
    await prisma.dataRightsRequest.updateMany({
      where: { user_id: ctx.user_id, type: "Erasure" },
      data: { requested_at: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });

    const deleted: string[] = [];
    const result = await processPendingErasures({
      gracePeriodHours: 24,
      deleteObject: async (k) => {
        deleted.push(k);
      },
    });

    expect(result.processed).toBe(1);
    expect(deleted).toEqual(["voice.webm"]);

    const user = await prisma.user.findUnique({ where: { id: ctx.user_id } });
    expect(user?.email).toBe(`erased+${ctx.user_id}@deleted.invalid`);
    expect(user?.name).toBeNull();
    expect(user?.erased_at).not.toBeNull();
    expect(user?.deleted_at).not.toBeNull();

    const attemptsLeft = await prisma.attempt.count({ where: { user_id: ctx.user_id } });
    expect(attemptsLeft).toBe(0);
    const consentsLeft = await prisma.consentRecord.count({ where: { user_id: ctx.user_id } });
    expect(consentsLeft).toBe(0);

    const req = await prisma.dataRightsRequest.findFirst({ where: { user_id: ctx.user_id } });
    expect(req?.status).toBe("Completed");
    expect(req?.fulfilled_at).not.toBeNull();
  });

  it("leaves erasures still inside the grace period untouched", async () => {
    const org = await createTestOrg("A");
    await seedActivity(org, 1);
    const ctx = learnerCtx(org, 0);
    await requestErasure(ctx); // requested_at = now, within grace

    const result = await processPendingErasures({ gracePeriodHours: 24 });
    expect(result.processed).toBe(0);

    const user = await prisma.user.findUnique({ where: { id: ctx.user_id } });
    expect(user?.erased_at).toBeNull();
  });
});
