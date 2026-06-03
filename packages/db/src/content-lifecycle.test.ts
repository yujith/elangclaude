// Tests for the approved-content lifecycle policy (retire / reopen / delete).
//
// Two layers:
//   1. Pure unit tests for planRetire / planReopen / planDelete — no DB.
//   2. Integration tests against the Neon test branch proving the DB facts the
//      policy depends on: retire removes a test from the Approved pool, and the
//      delete guard's attempt count is real and CROSS-ORG (a global Test can
//      carry attempts from any org, so the SuperAdmin client must not scope it).

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { withSuperAdminContext, type OrgContext } from "./tenancy";
import { planDelete, planReopen, planRetire } from "./content-lifecycle";
import { createTestOrg, resetDatabase } from "./test-helpers";

beforeEach(async () => {
  await resetDatabase();
});

describe("planRetire", () => {
  it("Approved → Rejected", () => {
    expect(planRetire("Approved")).toEqual({
      kind: "proceed",
      nextStatus: "Rejected",
    });
  });
  it("already Rejected is idempotent", () => {
    expect(planRetire("Rejected")).toEqual({ kind: "idempotent" });
  });
  it("refuses Draft / PendingReview", () => {
    expect(planRetire("Draft")).toEqual({
      kind: "invalid",
      currentStatus: "Draft",
    });
    expect(planRetire("PendingReview")).toEqual({
      kind: "invalid",
      currentStatus: "PendingReview",
    });
  });
});

describe("planReopen", () => {
  it("Approved → PendingReview", () => {
    expect(planReopen("Approved")).toEqual({
      kind: "proceed",
      nextStatus: "PendingReview",
    });
  });
  it("already PendingReview is idempotent", () => {
    expect(planReopen("PendingReview")).toEqual({ kind: "idempotent" });
  });
  it("refuses Draft / Rejected", () => {
    expect(planReopen("Draft")).toEqual({
      kind: "invalid",
      currentStatus: "Draft",
    });
    expect(planReopen("Rejected")).toEqual({
      kind: "invalid",
      currentStatus: "Rejected",
    });
  });
});

describe("planDelete", () => {
  it("zero attempts → proceed", () => {
    expect(planDelete(0)).toEqual({ kind: "proceed" });
  });
  it("any attempts → blocked with the count", () => {
    expect(planDelete(1)).toEqual({
      kind: "blocked",
      reason: "has_attempts",
      attemptCount: 1,
    });
    expect(planDelete(7)).toEqual({
      kind: "blocked",
      reason: "has_attempts",
      attemptCount: 7,
    });
  });
});

function superAdminCtx(org: { id: string; adminId: string }): OrgContext {
  return { org_id: org.id, user_id: org.adminId, role: "SuperAdmin" };
}

describe("lifecycle — DB integration", () => {
  it("retiring a test (Approved → Rejected) removes it from the Approved pool", async () => {
    const test = await prisma.test.create({
      data: {
        track: "Academic",
        section: "Reading",
        difficulty: 5,
        status: "Approved",
      },
    });

    // Learner picker reads the Approved pool — it is visible now.
    const before = await prisma.test.findMany({
      where: { section: "Reading", status: "Approved" },
      select: { id: true },
    });
    expect(before.map((t) => t.id)).toContain(test.id);

    const decision = planRetire("Approved");
    expect(decision.kind).toBe("proceed");
    await prisma.test.update({
      where: { id: test.id },
      data: { status: "Rejected" },
    });

    const after = await prisma.test.findMany({
      where: { section: "Reading", status: "Approved" },
      select: { id: true },
    });
    expect(after.map((t) => t.id)).not.toContain(test.id);
  });

  it("delete guard sees attempts from ANOTHER org (cross-org count via SuperAdmin client)", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");

    // One global Approved test, attempted only by a learner in org B.
    const test = await prisma.test.create({
      data: {
        track: "Academic",
        section: "Reading",
        difficulty: 5,
        status: "Approved",
      },
    });
    await prisma.attempt.create({
      data: {
        org_id: orgB.id,
        user_id: orgB.learnerIds[0]!,
        test_id: test.id,
        section: "Reading",
        status: "Submitted",
        submitted_at: new Date(),
      },
    });

    // A SuperAdmin whose home org is A must still count org B's attempt —
    // withSuperAdminContext returns the unscoped client by design.
    const db = withSuperAdminContext(superAdminCtx(orgA));
    const attemptCount = await db.attempt.count({
      where: { test_id: test.id },
    });
    expect(attemptCount).toBe(1);
    expect(planDelete(attemptCount)).toEqual({
      kind: "blocked",
      reason: "has_attempts",
      attemptCount: 1,
    });
  });

  it("an unattempted test deletes and cascades its questions", async () => {
    const test = await prisma.test.create({
      data: {
        track: "Academic",
        section: "Reading",
        difficulty: 5,
        status: "Approved",
        questions: {
          create: [
            { type: "reading-mcq", prompt: "Q1", position: 0 },
            { type: "reading-mcq", prompt: "Q2", position: 1 },
          ],
        },
      },
    });

    const attemptCount = await prisma.attempt.count({
      where: { test_id: test.id },
    });
    expect(planDelete(attemptCount)).toEqual({ kind: "proceed" });

    await prisma.test.delete({ where: { id: test.id } });

    expect(await prisma.test.count({ where: { id: test.id } })).toBe(0);
    // Question.test is onDelete: Cascade — the rows go with the parent.
    expect(
      await prisma.question.count({ where: { test_id: test.id } }),
    ).toBe(0);
  });
});
