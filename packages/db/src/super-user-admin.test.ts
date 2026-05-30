import { ClerkAPIResponseError } from "@clerk/backend/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./client";
import { SYSTEM_ORG_ID, SYSTEM_ORG_NAME } from "./system-org";
import {
  inviteOrgAdminForOrg,
  resetUserQuotaTodayAsSuperAdmin,
  setUserRoleAsSuperAdmin,
  softDeleteUserAsSuperAdmin,
  type OrgAdminInviteClerkClient,
} from "./super-user-admin";
import { withOrg } from "./tenancy";
import { createTestOrg, ctxFor, resetDatabase } from "./test-helpers";

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

// SuperAdmin doesn't sit inside an org row in tests; we just need a ctx
// with role=SuperAdmin so withSuperAdminContext() lets the helper through.
async function superCtx() {
  const orgA = await createTestOrg("Sup");
  return { org_id: orgA.id, user_id: orgA.adminId, role: "SuperAdmin" as const };
}

beforeEach(async () => {
  await resetDatabase();
  await ensureSystemOrg();
});

describe("inviteOrgAdminForOrg", () => {
  it("creates an OrgAdmin in the target org with an ActivityLog under SYSTEM_ORG_ID", async () => {
    const ctx = await superCtx();
    const orgB = await createTestOrg("B");

    const result = await inviteOrgAdminForOrg(
      ctx,
      {
        org_id: orgB.id,
        email: "new-admin@elc.test",
        name: "New Admin",
      },
      { skipClerkInvitation: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const newAdmin = await prisma.user.findUnique({
      where: { id: result.user_id },
      select: { org_id: true, role: true, email: true },
    });
    expect(newAdmin).toMatchObject({
      org_id: orgB.id,
      role: "OrgAdmin",
      email: "new-admin@elc.test",
    });
    const logs = await prisma.activityLog.findMany({
      where: { org_id: SYSTEM_ORG_ID, action: "super.user.invited" },
    });
    expect(logs).toHaveLength(1);
  });

  it("allows a cross-org email to create a second org membership (ADR-0018)", async () => {
    const ctx = await superCtx();
    const orgB = await createTestOrg("B");
    const orgC = await createTestOrg("C");
    const existingUser = await prisma.user.create({
      data: {
        org_id: orgC.id,
        email: "claimed@elc.test",
        role: "Learner",
      },
    });

    const result = await inviteOrgAdminForOrg(
      ctx,
      { org_id: orgB.id, email: "claimed@elc.test" },
      { skipClerkInvitation: true },
    );
    // With multi-org, the same email can exist in multiple orgs, so this succeeds
    expect(result.ok).toBe(true);

    // The new row in orgB should be separate from the existing Learner in orgC
    const newUserInOrgB = await prisma.user.findFirst({
      where: { email: "claimed@elc.test", org_id: orgB.id },
    });
    expect(newUserInOrgB).not.toBeNull();
    expect(newUserInOrgB?.role).toBe("OrgAdmin");
    expect(newUserInOrgB?.id).not.toBe(existingUser.id);
  });

  it("refuses to re-invite a soft-deleted same-org email", async () => {
    const ctx = await superCtx();
    const orgB = await createTestOrg("B");
    await prisma.user.create({
      data: {
        org_id: orgB.id,
        email: "left@elc.test",
        role: "Learner",
        deleted_at: new Date(),
      },
    });
    const result = await inviteOrgAdminForOrg(
      ctx,
      { org_id: orgB.id, email: "left@elc.test" },
      { skipClerkInvitation: true },
    );
    expect(result).toEqual({ ok: false, reason: "cannot_invite" });
  });

  it("promotes an existing same-org Learner in place", async () => {
    const ctx = await superCtx();
    const orgB = await createTestOrg("B");
    const learner = await prisma.user.create({
      data: { org_id: orgB.id, email: "promote@elc.test", role: "Learner" },
    });
    const result = await inviteOrgAdminForOrg(
      ctx,
      { org_id: orgB.id, email: "promote@elc.test" },
      { skipClerkInvitation: true },
    );
    expect(result.ok).toBe(true);
    const after = await prisma.user.findUnique({ where: { id: learner.id } });
    expect(after?.role).toBe("OrgAdmin");
  });

  it("refuses to invite under SYSTEM_ORG_ID", async () => {
    const ctx = await superCtx();
    const result = await inviteOrgAdminForOrg(
      ctx,
      { org_id: SYSTEM_ORG_ID, email: "sys@elc.test" },
      { skipClerkInvitation: true },
    );
    expect(result).toEqual({ ok: false, reason: "org_not_found" });
  });
});

// ─── ADR-0017 Phase 3: Clerk invitation path ──────────────────────────

function buildClerkStub() {
  const createOrganizationInvitation = vi.fn(async () => ({
    id: `orginv_${Math.random().toString(16).slice(2, 8)}`,
  }));
  const client: OrgAdminInviteClerkClient = {
    organizations: { createOrganizationInvitation },
  };
  return { client, createOrganizationInvitation };
}

async function withClerkLinkedSuperAndOrg() {
  const ctx = await superCtx();
  // SuperAdmin needs a clerk_user_id stamped (the inviter). Lazy-link
  // doesn't run inside the test environment so we set it explicitly.
  await prisma.user.update({
    where: { id: ctx.user_id },
    data: { clerk_user_id: "user_super_test_123" },
  });
  const orgB = await createTestOrg("ClerkInvite");
  // Org needs a clerk_org_id to receive an org-level invitation.
  await prisma.organization.update({
    where: { id: orgB.id },
    data: { clerk_org_id: "org_test_target" },
  });
  return { ctx, orgB };
}

describe("inviteOrgAdminForOrg — Clerk org-invitation path", () => {
  it("sends the Clerk invitation, stamps billing_owner_user_id, and logs", async () => {
    const { ctx, orgB } = await withClerkLinkedSuperAndOrg();
    const { client, createOrganizationInvitation } = buildClerkStub();

    const result = await inviteOrgAdminForOrg(
      ctx,
      {
        org_id: orgB.id,
        email: "fresh-admin@elc.test",
        name: "Fresh Admin",
      },
      { clerkClient: client, appUrl: "http://localhost:3000" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(createOrganizationInvitation).toHaveBeenCalledTimes(1);
    expect(createOrganizationInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_test_target",
        emailAddress: "fresh-admin@elc.test",
        inviterUserId: "user_super_test_123",
        role: "org:admin",
        publicMetadata: expect.objectContaining({
          org_id: orgB.id,
          role: "OrgAdmin",
        }),
      }),
    );

    const refreshedOrg = await prisma.organization.findUniqueOrThrow({
      where: { id: orgB.id },
    });
    expect(refreshedOrg.billing_owner_user_id).toBe(result.user_id);
  });

  it("refuses when the target Org has no clerk_org_id (and rolls back the User row)", async () => {
    const ctx = await superCtx();
    await prisma.user.update({
      where: { id: ctx.user_id },
      data: { clerk_user_id: "user_super_test_456" },
    });
    const orgB = await createTestOrg("NoClerkOrg");
    // Intentionally leave orgB.clerk_org_id null.
    const { client, createOrganizationInvitation } = buildClerkStub();

    const before = await prisma.user.count({ where: { org_id: orgB.id } });
    const result = await inviteOrgAdminForOrg(
      ctx,
      { org_id: orgB.id, email: "fresh@elc.test" },
      { clerkClient: client, appUrl: "http://localhost:3000" },
    );
    expect(result).toEqual({
      ok: false,
      reason: "org_has_no_clerk_org",
    });
    expect(createOrganizationInvitation).not.toHaveBeenCalled();

    const after = await prisma.user.count({ where: { org_id: orgB.id } });
    expect(after).toBe(before); // user row rolled back
  });

  it("treats Clerk's duplicate_record as idempotent success", async () => {
    const { ctx, orgB } = await withClerkLinkedSuperAndOrg();
    const client: OrgAdminInviteClerkClient = {
      organizations: {
        createOrganizationInvitation: vi.fn(async () => {
          throw new ClerkAPIResponseError("Duplicate", {
            data: [
              {
                code: "duplicate_record",
                message: "Duplicate",
                long_message: "Duplicate",
                meta: {},
              },
            ],
            status: 422,
            clerkTraceId: "test-trace",
          });
        }),
      },
    };

    const result = await inviteOrgAdminForOrg(
      ctx,
      { org_id: orgB.id, email: "dup@elc.test" },
      { clerkClient: client, appUrl: "http://localhost:3000" },
    );
    expect(result.ok).toBe(true);
  });

  it("does NOT overwrite an existing billing_owner_user_id when a second OrgAdmin is invited", async () => {
    const { ctx, orgB } = await withClerkLinkedSuperAndOrg();
    const { client } = buildClerkStub();

    // First OrgAdmin — becomes billing owner.
    const first = await inviteOrgAdminForOrg(
      ctx,
      { org_id: orgB.id, email: "first@elc.test" },
      { clerkClient: client, appUrl: "http://localhost:3000" },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Second OrgAdmin — billing owner stays the first user.
    const second = await inviteOrgAdminForOrg(
      ctx,
      { org_id: orgB.id, email: "second@elc.test" },
      { clerkClient: client, appUrl: "http://localhost:3000" },
    );
    expect(second.ok).toBe(true);

    const refreshedOrg = await prisma.organization.findUniqueOrThrow({
      where: { id: orgB.id },
    });
    expect(refreshedOrg.billing_owner_user_id).toBe(first.user_id);
  });
});

describe("setUserRoleAsSuperAdmin", () => {
  it("promoting a user in org A does not affect org B's users", async () => {
    const ctx = await superCtx();
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    const targetLearner = await prisma.user.findFirst({
      where: { org_id: orgA.id, role: "Learner" },
      select: { id: true },
    });
    expect(targetLearner).not.toBeNull();

    const result = await setUserRoleAsSuperAdmin(ctx, {
      user_id: targetLearner!.id,
      role: "OrgAdmin",
    });
    expect(result.ok).toBe(true);

    // Org B's roles are untouched.
    const dbB = withOrg(ctxFor(orgB));
    const bRoles = await dbB.user.findMany({ select: { role: true } });
    expect(bRoles.filter((u) => u.role === "OrgAdmin")).toHaveLength(1);
  });

  it("refuses to demote the last active OrgAdmin", async () => {
    const ctx = await superCtx();
    const orgB = await createTestOrg("B");
    const result = await setUserRoleAsSuperAdmin(ctx, {
      user_id: orgB.adminId,
      role: "Learner",
    });
    expect(result).toEqual({ ok: false, reason: "last_admin" });

    // Promote a Learner first, then the demote of the original admin is allowed.
    const otherLearner = await prisma.user.findFirst({
      where: { org_id: orgB.id, role: "Learner" },
      select: { id: true },
    });
    await setUserRoleAsSuperAdmin(ctx, {
      user_id: otherLearner!.id,
      role: "OrgAdmin",
    });
    const second = await setUserRoleAsSuperAdmin(ctx, {
      user_id: orgB.adminId,
      role: "Learner",
    });
    expect(second.ok).toBe(true);
  });

  it("refuses to act on a SuperAdmin", async () => {
    const ctx = await superCtx();
    const orgB = await createTestOrg("B");
    const superRow = await prisma.user.create({
      data: { org_id: orgB.id, email: "super-2@elc.test", role: "SuperAdmin" },
    });
    const result = await setUserRoleAsSuperAdmin(ctx, {
      user_id: superRow.id,
      role: "OrgAdmin",
    });
    expect(result).toEqual({ ok: false, reason: "cannot_change_super_admin" });
  });

  it("refuses to act on a soft-deleted user", async () => {
    const ctx = await superCtx();
    const orgB = await createTestOrg("B");
    const removed = await prisma.user.create({
      data: {
        org_id: orgB.id,
        email: "gone@elc.test",
        role: "Learner",
        deleted_at: new Date(),
      },
    });
    const result = await setUserRoleAsSuperAdmin(ctx, {
      user_id: removed.id,
      role: "OrgAdmin",
    });
    expect(result).toEqual({ ok: false, reason: "user_deleted" });
  });

  it("refuses when expected_org_id does not match the user's actual org", async () => {
    const ctx = await superCtx();
    const orgB = await createTestOrg("B");
    const orgC = await createTestOrg("C");
    const targetLearner = await prisma.user.findFirst({
      where: { org_id: orgB.id, role: "Learner" },
      select: { id: true, role: true },
    });
    expect(targetLearner).not.toBeNull();
    // Form was submitted with org_id=C but user belongs to B.
    const result = await setUserRoleAsSuperAdmin(ctx, {
      user_id: targetLearner!.id,
      role: "OrgAdmin",
      expected_org_id: orgC.id,
    });
    expect(result).toEqual({ ok: false, reason: "org_mismatch" });
    // And the user's role is unchanged.
    const after = await prisma.user.findUnique({
      where: { id: targetLearner!.id },
      select: { role: true },
    });
    expect(after?.role).toBe(targetLearner!.role);
  });
});

describe("softDeleteUserAsSuperAdmin", () => {
  it("hides the user from withOrg() rosters but withSuperAdminContext can still see them", async () => {
    const ctx = await superCtx();
    const orgB = await createTestOrg("B");
    const learner = await prisma.user.findFirst({
      where: { org_id: orgB.id, role: "Learner" },
      select: { id: true, email: true },
    });
    expect(learner).not.toBeNull();

    const result = await softDeleteUserAsSuperAdmin(ctx, {
      user_id: learner!.id,
    });
    expect(result.ok).toBe(true);

    // OrgAdmin-style roster query (deleted_at: null) hides the row.
    const dbB = withOrg(ctxFor(orgB));
    const roster = await dbB.user.findMany({
      where: { role: "Learner", deleted_at: null },
      select: { id: true },
    });
    expect(roster.some((u) => u.id === learner!.id)).toBe(false);

    // Super-side queries still see the row, deleted_at populated.
    const row = await prisma.user.findUnique({ where: { id: learner!.id } });
    expect(row?.deleted_at).not.toBeNull();
  });

  it("refuses to remove the last active OrgAdmin", async () => {
    const ctx = await superCtx();
    const orgB = await createTestOrg("B");
    const result = await softDeleteUserAsSuperAdmin(ctx, {
      user_id: orgB.adminId,
    });
    expect(result).toEqual({ ok: false, reason: "last_admin" });
  });

  it("is idempotent — soft-deleting an already-removed user is a no-op success", async () => {
    const ctx = await superCtx();
    const orgB = await createTestOrg("B");
    const removed = await prisma.user.create({
      data: {
        org_id: orgB.id,
        email: "already-gone@elc.test",
        role: "Learner",
        deleted_at: new Date("2020-01-01"),
      },
    });
    const before = await prisma.user.findUnique({
      where: { id: removed.id },
      select: { deleted_at: true },
    });
    const result = await softDeleteUserAsSuperAdmin(ctx, {
      user_id: removed.id,
    });
    expect(result.ok).toBe(true);
    const after = await prisma.user.findUnique({
      where: { id: removed.id },
      select: { deleted_at: true },
    });
    expect(after?.deleted_at?.toISOString()).toBe(
      before?.deleted_at?.toISOString(),
    );
  });
});

describe("resetUserQuotaTodayAsSuperAdmin", () => {
  it("upserts today's QuotaUsage row to 0", async () => {
    const ctx = await superCtx();
    const orgB = await createTestOrg("B");
    const learner = await prisma.user.findFirst({
      where: { org_id: orgB.id, role: "Learner" },
      select: { id: true },
    });
    const today = startOfUtcToday();
    await prisma.quotaUsage.create({
      data: {
        org_id: orgB.id,
        user_id: learner!.id,
        date: today,
        ai_calls_count: 42,
      },
    });
    const result = await resetUserQuotaTodayAsSuperAdmin(ctx, {
      user_id: learner!.id,
    });
    expect(result.ok).toBe(true);
    const row = await prisma.quotaUsage.findUnique({
      where: { user_id_date: { user_id: learner!.id, date: today } },
    });
    expect(row?.ai_calls_count).toBe(0);
  });
});

function startOfUtcToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}
