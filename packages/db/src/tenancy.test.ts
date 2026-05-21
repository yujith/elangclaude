import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./client";
import { SYSTEM_ORG_ID, SYSTEM_ORG_NAME } from "./system-org";
import {
  RoleRequiredError,
  withOrg,
  withSuperAdminContext,
} from "./tenancy";
import {
  createTestOrg,
  ctxFor,
  findTenantSetDrift,
  resetDatabase,
  seedActivity,
} from "./test-helpers";

beforeEach(async () => {
  await resetDatabase();
});

describe("withOrg() — read isolation", () => {
  it("findMany returns only the caller's org", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    await seedActivity(orgA, 2);
    await seedActivity(orgB, 2);

    const dbA = withOrg(ctxFor(orgA));
    const users = await dbA.user.findMany();

    expect(users.length).toBeGreaterThan(0);
    expect(users.every((u) => u.org_id === orgA.id)).toBe(true);
  });

  it("findUnique by an orgB id returns null from orgA's client", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    const { attemptIds: bAttempts } = await seedActivity(orgB, 1);
    const targetId = bAttempts[0]!;

    const dbA = withOrg(ctxFor(orgA));
    const leak = await dbA.attempt.findUnique({ where: { id: targetId } });
    expect(leak).toBeNull();
  });

  it("findFirst by an orgB id returns null from orgA's client", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    const { attemptIds } = await seedActivity(orgB, 1);

    const dbA = withOrg(ctxFor(orgA));
    const leak = await dbA.attempt.findFirst({ where: { id: attemptIds[0] } });
    expect(leak).toBeNull();
  });

  it("count + aggregate only counts the caller's rows", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    await seedActivity(orgA, 4); // 3 learners × 4 = 12 attempts
    await seedActivity(orgB, 4);

    const dbA = withOrg(ctxFor(orgA));
    const count = await dbA.attempt.count();
    const agg = await dbA.attempt.aggregate({ _count: { _all: true } });

    expect(count).toBe(12);
    expect(agg._count._all).toBe(12);
  });

  it("groupBy only groups the caller's rows", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    await seedActivity(orgA, 3);
    await seedActivity(orgB, 3);

    const dbA = withOrg(ctxFor(orgA));
    const groups = await dbA.attempt.groupBy({
      by: ["section"],
      _count: { _all: true },
    });
    const total = groups.reduce((sum, g) => sum + g._count._all, 0);
    expect(total).toBe(9);
  });
});

describe("withOrg() — write isolation", () => {
  it("updateMany against orgB rows from orgA's client touches 0 rows", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    const { attemptIds } = await seedActivity(orgB, 1);

    const dbA = withOrg(ctxFor(orgA));
    const result = await dbA.attempt.updateMany({
      where: { id: { in: attemptIds } },
      data: { status: "Abandoned" },
    });
    expect(result.count).toBe(0);

    // And the row in orgB is untouched
    const stillSubmitted = await prisma.attempt.findUnique({
      where: { id: attemptIds[0] },
    });
    expect(stillSubmitted?.status).toBe("Submitted");
  });

  it("update against an orgB row throws P2025 from orgA's client", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    const { attemptIds } = await seedActivity(orgB, 1);

    const dbA = withOrg(ctxFor(orgA));
    await expect(
      dbA.attempt.update({
        where: { id: attemptIds[0] },
        data: { status: "Abandoned" },
      }),
    ).rejects.toMatchObject({ code: "P2025" });
  });

  it("deleteMany against orgB rows from orgA's client deletes nothing", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    const { attemptIds } = await seedActivity(orgB, 2);

    const dbA = withOrg(ctxFor(orgA));
    const result = await dbA.attempt.deleteMany({
      where: { id: { in: attemptIds } },
    });
    expect(result.count).toBe(0);

    const remaining = await prisma.attempt.count({
      where: { id: { in: attemptIds } },
    });
    expect(remaining).toBe(attemptIds.length);
  });
});

describe("withOrg() — create/upsert clamping", () => {
  it("create clamps a smuggled org_id to ctx.org_id", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");

    const dbA = withOrg(ctxFor(orgA));
    const log = await dbA.activityLog.create({
      // A malicious caller smuggling an orgB id should be clamped to orgA.
      data: {
        org_id: orgB.id,
        user_id: orgA.adminId,
        action: "smuggled",
      } as Prisma.ActivityLogUncheckedCreateInput,
    });
    expect(log.org_id).toBe(orgA.id);
  });

  it("createMany clamps every row's org_id to ctx.org_id", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");

    const dbA = withOrg(ctxFor(orgA));
    await dbA.activityLog.createMany({
      data: [
        { org_id: orgB.id, action: "row1", user_id: orgA.adminId },
        { org_id: orgB.id, action: "row2", user_id: orgA.adminId },
      ] as Prisma.ActivityLogCreateManyInput[],
    });

    const orgBLogs = await prisma.activityLog.count({
      where: { org_id: orgB.id, action: { in: ["row1", "row2"] } },
    });
    expect(orgBLogs).toBe(0);

    const orgALogs = await prisma.activityLog.count({
      where: { org_id: orgA.id, action: { in: ["row1", "row2"] } },
    });
    expect(orgALogs).toBe(2);
  });

  it("update payload cannot move a row to another org", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    const { attemptIds } = await seedActivity(orgA, 1);

    const dbA = withOrg(ctxFor(orgA));
    const updated = await dbA.attempt.update({
      where: { id: attemptIds[0] },
      data: { org_id: orgB.id, status: "Abandoned" } as Prisma.AttemptUncheckedUpdateInput,
    });
    expect(updated.org_id).toBe(orgA.id);
    expect(updated.status).toBe("Abandoned");
  });
});

describe("withOrg() — relation includes inherit isolation", () => {
  it("findMany with include only returns relations belonging to the org", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    await seedActivity(orgA, 2);
    await seedActivity(orgB, 2);

    const dbA = withOrg(ctxFor(orgA));
    const attempts = await dbA.attempt.findMany({
      include: { user: true, answers: true },
    });
    // Every loaded relation is parented by an orgA row, so all reachable users
    // are orgA's. This is implicit isolation through FK graph, not the proxy.
    expect(attempts.every((a) => a.user.org_id === orgA.id)).toBe(true);
  });
});

describe("withSuperAdminContext()", () => {
  it("rejects non-SuperAdmin callers with RoleRequiredError", async () => {
    const orgA = await createTestOrg("A");
    expect(() => withSuperAdminContext(ctxFor(orgA, "OrgAdmin"))).toThrow(
      RoleRequiredError,
    );
    expect(() => withSuperAdminContext(ctxFor(orgA, "Learner"))).toThrow(
      RoleRequiredError,
    );
  });

  it("returns a client that can read both orgs", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    await seedActivity(orgA, 1);
    await seedActivity(orgB, 1);

    const su = withSuperAdminContext({
      org_id: orgA.id,
      user_id: orgA.adminId,
      role: "SuperAdmin",
    });
    const orgIds = new Set(
      (await su.attempt.findMany({ select: { org_id: true } })).map(
        (a) => a.org_id,
      ),
    );
    expect(orgIds).toEqual(new Set([orgA.id, orgB.id]));
  });
});

describe("MockSession — isolation", () => {
  // MockSession joined the tenant-scoped set in ADR 0008. The drift
  // guard catches accidental removal from the set, but doesn't exercise
  // the proxy against it. This block covers the proxy: read isolation,
  // create org_id clamping, and the Attempt.mock_session_id FK staying
  // sane across orgs.
  it("findMany returns only the caller's mock sessions", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    await prisma.mockSession.create({
      data: { org_id: orgA.id, user_id: orgA.learnerIds[0]!, track: "Academic" },
    });
    await prisma.mockSession.create({
      data: { org_id: orgB.id, user_id: orgB.learnerIds[0]!, track: "Academic" },
    });

    const dbA = withOrg(ctxFor(orgA));
    const sessions = await dbA.mockSession.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.org_id).toBe(orgA.id);
  });

  it("findUnique by an orgB MockSession id returns null from orgA", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    const bSession = await prisma.mockSession.create({
      data: { org_id: orgB.id, user_id: orgB.learnerIds[0]!, track: "Academic" },
    });

    const dbA = withOrg(ctxFor(orgA));
    const leak = await dbA.mockSession.findUnique({
      where: { id: bSession.id },
    });
    expect(leak).toBeNull();
  });

  it("create clamps a smuggled org_id on MockSession to ctx.org_id", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");

    const dbA = withOrg(ctxFor(orgA));
    const created = await dbA.mockSession.create({
      data: {
        // Smuggle attempt — proxy must clamp to orgA.
        org_id: orgB.id,
        user_id: orgA.learnerIds[0]!,
        track: "Academic",
      },
    });
    expect(created.org_id).toBe(orgA.id);
  });
});

describe("schema/runtime drift guard", () => {
  it("TENANT_SCOPED_MODELS matches the live Prisma datamodel", () => {
    const drift = findTenantSetDrift();
    expect(drift).toEqual({ missingFromSet: [], extraInSet: [] });
  });
});

describe("SYSTEM_ORG_ID — super-level events stay out of OrgAdmin views", () => {
  // The singleton 'system' org parents super-level ActivityLog rows
  // (content.* moderation, super.org.* CRUD). OrgAdmins must never see
  // these in their own activity feeds. withOrg(ctx) already filters by
  // org_id, but the invariant is worth a guard rail.
  async function ensureSystemOrg() {
    await prisma.organization.upsert({
      where: { id: SYSTEM_ORG_ID },
      update: { name: SYSTEM_ORG_NAME, status: "Archived" },
      create: {
        id: SYSTEM_ORG_ID,
        name: SYSTEM_ORG_NAME,
        seat_limit: 0,
        quota_daily: 0,
        quota_monthly: 0,
        status: "Archived",
      },
    });
  }

  it("OrgAdmin's withOrg() activity feed never returns system-org rows", async () => {
    await ensureSystemOrg();
    const orgA = await createTestOrg("A");
    await seedActivity(orgA, 1);

    // Simulate a SuperAdmin moderation event landing under the system org.
    await prisma.activityLog.create({
      data: {
        org_id: SYSTEM_ORG_ID,
        user_id: orgA.adminId,
        action: "content.reading.approved",
        metadata: { test_id: "fake-test" },
      },
    });

    const dbA = withOrg(ctxFor(orgA));
    const rows = await dbA.activityLog.findMany();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.org_id === orgA.id)).toBe(true);
    expect(rows.some((r) => r.action.startsWith("content."))).toBe(false);
  });

  it("withSuperAdminContext() can read both system and customer org logs", async () => {
    await ensureSystemOrg();
    const orgA = await createTestOrg("A");
    await prisma.activityLog.create({
      data: {
        org_id: SYSTEM_ORG_ID,
        user_id: orgA.adminId,
        action: "super.org.created",
        metadata: { org_id: orgA.id },
      },
    });

    const su = withSuperAdminContext({
      org_id: orgA.id,
      user_id: orgA.adminId,
      role: "SuperAdmin",
    });
    const systemLogs = await su.activityLog.findMany({
      where: { org_id: SYSTEM_ORG_ID },
    });
    expect(systemLogs.some((r) => r.action === "super.org.created")).toBe(true);
  });
});
