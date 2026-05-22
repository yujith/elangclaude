import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { resetDatabase } from "./test-helpers";
import {
  CLERK_NEW_ORG_DEFAULTS,
  applyClerkMembershipDeleted,
  applyClerkMembershipUpsert,
  applyClerkOrgDeleted,
  applyClerkOrgUpsert,
  applyClerkUserDeleted,
  applyClerkUserUpsert,
  joinName,
  mapClerkRole,
  pickPrimaryEmail,
} from "./clerk-sync";

beforeEach(async () => {
  await resetDatabase();
});

// ─── Pure helpers ───────────────────────────────────────────────────────

describe("mapClerkRole", () => {
  it("maps org:admin and bare admin to OrgAdmin", () => {
    expect(mapClerkRole("org:admin")).toBe("OrgAdmin");
    expect(mapClerkRole("admin")).toBe("OrgAdmin");
    expect(mapClerkRole("ADMIN")).toBe("OrgAdmin");
  });

  it("maps everything else to Learner so an unknown role can never grant admin", () => {
    expect(mapClerkRole("org:basic_member")).toBe("Learner");
    expect(mapClerkRole("basic_member")).toBe("Learner");
    expect(mapClerkRole("org:custom_owner")).toBe("Learner");
    expect(mapClerkRole("")).toBe("Learner");
  });
});

describe("pickPrimaryEmail", () => {
  it("picks the primary email and lowercases / trims it", () => {
    const email = pickPrimaryEmail({
      id: "user_1",
      primary_email_address_id: "email_b",
      email_addresses: [
        { id: "email_a", email_address: "other@example.com" },
        { id: "email_b", email_address: "  Yujith@Example.COM " },
      ],
      first_name: null,
      last_name: null,
    });
    expect(email).toBe("yujith@example.com");
  });

  it("falls back to the first address when primary id is missing", () => {
    const email = pickPrimaryEmail({
      id: "user_1",
      primary_email_address_id: null,
      email_addresses: [{ id: "email_a", email_address: "first@example.com" }],
      first_name: null,
      last_name: null,
    });
    expect(email).toBe("first@example.com");
  });

  it("returns null when there are no addresses at all", () => {
    const email = pickPrimaryEmail({
      id: "user_1",
      primary_email_address_id: null,
      email_addresses: [],
      first_name: null,
      last_name: null,
    });
    expect(email).toBeNull();
  });
});

describe("joinName", () => {
  it("joins first + last with a space, ignoring nulls and whitespace", () => {
    expect(joinName("Yujith", "Perera")).toBe("Yujith Perera");
    expect(joinName("Yujith", null)).toBe("Yujith");
    expect(joinName(null, "Perera")).toBe("Perera");
    expect(joinName(null, null)).toBeNull();
    expect(joinName("  ", "  ")).toBeNull();
  });
});

// ─── User events ────────────────────────────────────────────────────────

describe("applyClerkUserUpsert", () => {
  it("lazy-links by email onto an existing seeded row and updates the name", async () => {
    const org = await prisma.organization.create({
      data: { name: "Demo", seat_limit: 5, quota_daily: 10, quota_monthly: 100 },
    });
    const seeded = await prisma.user.create({
      data: {
        org_id: org.id,
        email: "yujith@example.com",
        role: "SuperAdmin",
      },
    });

    await applyClerkUserUpsert({
      id: "user_clerk_1",
      primary_email_address_id: "email_a",
      email_addresses: [{ id: "email_a", email_address: "yujith@example.com" }],
      first_name: "Yujith",
      last_name: "Perera",
    });

    const after = await prisma.user.findUnique({ where: { id: seeded.id } });
    expect(after?.clerk_user_id).toBe("user_clerk_1");
    expect(after?.name).toBe("Yujith Perera");
    // Role must NOT be touched — only org admins / the seed control that.
    expect(after?.role).toBe("SuperAdmin");
  });

  it("updates mutable fields on a re-delivery once the row is linked", async () => {
    const org = await prisma.organization.create({
      data: { name: "Demo", seat_limit: 5, quota_daily: 10, quota_monthly: 100 },
    });
    const seeded = await prisma.user.create({
      data: {
        org_id: org.id,
        clerk_user_id: "user_clerk_1",
        email: "old@example.com",
        name: "Old Name",
        role: "Learner",
      },
    });

    await applyClerkUserUpsert({
      id: "user_clerk_1",
      primary_email_address_id: "email_a",
      email_addresses: [{ id: "email_a", email_address: "new@example.com" }],
      first_name: "New",
      last_name: "Name",
    });

    const after = await prisma.user.findUnique({ where: { id: seeded.id } });
    expect(after?.email).toBe("new@example.com");
    expect(after?.name).toBe("New Name");
  });

  it("is a no-op when no email matches any DB row (defer to membership)", async () => {
    await applyClerkUserUpsert({
      id: "user_clerk_orphan",
      primary_email_address_id: "email_a",
      email_addresses: [{ id: "email_a", email_address: "stranger@example.com" }],
      first_name: "Stranger",
      last_name: null,
    });

    const count = await prisma.user.count();
    expect(count).toBe(0);
  });
});

describe("applyClerkUserDeleted", () => {
  it("soft-deletes a linked user", async () => {
    const org = await prisma.organization.create({
      data: { name: "Demo", seat_limit: 5, quota_daily: 10, quota_monthly: 100 },
    });
    const user = await prisma.user.create({
      data: {
        org_id: org.id,
        clerk_user_id: "user_clerk_1",
        email: "yujith@example.com",
        role: "Learner",
      },
    });

    await applyClerkUserDeleted("user_clerk_1");

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after?.deleted_at).not.toBeNull();
  });

  it("is idempotent — re-delivery on an already-deleted user does not re-stamp deleted_at", async () => {
    const org = await prisma.organization.create({
      data: { name: "Demo", seat_limit: 5, quota_daily: 10, quota_monthly: 100 },
    });
    const firstDelete = new Date("2026-01-01T00:00:00Z");
    const user = await prisma.user.create({
      data: {
        org_id: org.id,
        clerk_user_id: "user_clerk_1",
        email: "yujith@example.com",
        role: "Learner",
        deleted_at: firstDelete,
      },
    });

    await applyClerkUserDeleted("user_clerk_1");

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after?.deleted_at?.getTime()).toBe(firstDelete.getTime());
  });

  it("ignores unknown Clerk user ids", async () => {
    await expect(applyClerkUserDeleted("user_unknown")).resolves.toBeUndefined();
  });
});

// ─── Organization events ────────────────────────────────────────────────

describe("applyClerkOrgUpsert", () => {
  it("creates an Active org with conservative quota defaults on first delivery", async () => {
    await applyClerkOrgUpsert({ id: "org_clerk_1", name: "New School" });

    const org = await prisma.organization.findUnique({
      where: { clerk_org_id: "org_clerk_1" },
    });
    expect(org?.name).toBe("New School");
    expect(org?.status).toBe("Active");
    expect(org?.seat_limit).toBe(CLERK_NEW_ORG_DEFAULTS.seat_limit);
    expect(org?.quota_daily).toBe(CLERK_NEW_ORG_DEFAULTS.quota_daily);
    expect(org?.quota_monthly).toBe(CLERK_NEW_ORG_DEFAULTS.quota_monthly);
  });

  it("updates the name on a re-delivery without touching seat_limit / quotas", async () => {
    const existing = await prisma.organization.create({
      data: {
        clerk_org_id: "org_clerk_1",
        name: "Old Name",
        seat_limit: 99,
        quota_daily: 500,
        quota_monthly: 9999,
        status: "Active",
      },
    });

    await applyClerkOrgUpsert({ id: "org_clerk_1", name: "Renamed" });

    const after = await prisma.organization.findUnique({ where: { id: existing.id } });
    expect(after?.name).toBe("Renamed");
    expect(after?.seat_limit).toBe(99);
    expect(after?.quota_daily).toBe(500);
    expect(after?.quota_monthly).toBe(9999);
  });
});

describe("applyClerkOrgDeleted", () => {
  it("archives the org rather than hard-deleting (preserves history)", async () => {
    const existing = await prisma.organization.create({
      data: {
        clerk_org_id: "org_clerk_1",
        name: "Old School",
        seat_limit: 5,
        quota_daily: 10,
        quota_monthly: 100,
        status: "Active",
      },
    });

    await applyClerkOrgDeleted("org_clerk_1");

    const after = await prisma.organization.findUnique({ where: { id: existing.id } });
    expect(after?.status).toBe("Archived");
  });

  it("ignores unknown Clerk org ids", async () => {
    await expect(applyClerkOrgDeleted("org_unknown")).resolves.toBeUndefined();
  });
});

// ─── Membership events ──────────────────────────────────────────────────

describe("applyClerkMembershipUpsert", () => {
  it("ensures both org and user exist, sets role from Clerk admin -> OrgAdmin", async () => {
    await applyClerkMembershipUpsert({
      id: "mem_1",
      role: "org:admin",
      organization: { id: "org_clerk_1", name: "Migration Pathways" },
      public_user_data: {
        user_id: "user_clerk_1",
        identifier: "admin@example.com",
        first_name: "Admin",
        last_name: "One",
      },
    });

    const org = await prisma.organization.findUnique({
      where: { clerk_org_id: "org_clerk_1" },
    });
    expect(org?.name).toBe("Migration Pathways");
    expect(org?.status).toBe("Active");

    const user = await prisma.user.findUnique({
      where: { clerk_user_id: "user_clerk_1" },
    });
    expect(user?.email).toBe("admin@example.com");
    expect(user?.role).toBe("OrgAdmin");
    expect(user?.org_id).toBe(org?.id);
    expect(user?.deleted_at).toBeNull();
  });

  it("maps unknown roles to Learner so an unexpected role never grants admin", async () => {
    await applyClerkMembershipUpsert({
      id: "mem_1",
      role: "org:custom_special_role",
      organization: { id: "org_clerk_1", name: "Migration Pathways" },
      public_user_data: {
        user_id: "user_clerk_1",
        identifier: "user@example.com",
        first_name: null,
        last_name: null,
      },
    });

    const user = await prisma.user.findUnique({
      where: { clerk_user_id: "user_clerk_1" },
    });
    expect(user?.role).toBe("Learner");
  });

  it("re-activates a previously soft-deleted user when membership returns", async () => {
    const org = await prisma.organization.create({
      data: {
        clerk_org_id: "org_clerk_1",
        name: "Org",
        seat_limit: 5,
        quota_daily: 10,
        quota_monthly: 100,
      },
    });
    await prisma.user.create({
      data: {
        org_id: org.id,
        clerk_user_id: "user_clerk_1",
        email: "former@example.com",
        role: "Learner",
        deleted_at: new Date("2026-01-01T00:00:00Z"),
      },
    });

    await applyClerkMembershipUpsert({
      id: "mem_1",
      role: "org:basic_member",
      organization: { id: "org_clerk_1", name: "Org" },
      public_user_data: {
        user_id: "user_clerk_1",
        identifier: "former@example.com",
        first_name: null,
        last_name: null,
      },
    });

    const user = await prisma.user.findUnique({
      where: { clerk_user_id: "user_clerk_1" },
    });
    expect(user?.deleted_at).toBeNull();
    expect(user?.role).toBe("Learner");
  });

  it("never demotes a SuperAdmin — DB role wins over the Clerk membership role", async () => {
    const org = await prisma.organization.create({
      data: {
        clerk_org_id: "org_clerk_1",
        name: "Org",
        seat_limit: 5,
        quota_daily: 10,
        quota_monthly: 100,
      },
    });
    await prisma.user.create({
      data: {
        org_id: org.id,
        clerk_user_id: "user_clerk_1",
        email: "super@example.com",
        role: "SuperAdmin",
      },
    });

    await applyClerkMembershipUpsert({
      id: "mem_1",
      role: "org:admin",
      organization: { id: "org_clerk_1", name: "Org" },
      public_user_data: {
        user_id: "user_clerk_1",
        identifier: "super@example.com",
        first_name: null,
        last_name: null,
      },
    });

    const user = await prisma.user.findUnique({
      where: { clerk_user_id: "user_clerk_1" },
    });
    expect(user?.role).toBe("SuperAdmin");
  });

  it("transfers a user between orgs by updating org_id when Clerk reports a new membership", async () => {
    const orgA = await prisma.organization.create({
      data: {
        clerk_org_id: "org_clerk_a",
        name: "A",
        seat_limit: 5,
        quota_daily: 10,
        quota_monthly: 100,
      },
    });
    await prisma.user.create({
      data: {
        org_id: orgA.id,
        clerk_user_id: "user_clerk_1",
        email: "mover@example.com",
        role: "Learner",
      },
    });

    await applyClerkMembershipUpsert({
      id: "mem_1",
      role: "org:admin",
      organization: { id: "org_clerk_b", name: "B" },
      public_user_data: {
        user_id: "user_clerk_1",
        identifier: "mover@example.com",
        first_name: null,
        last_name: null,
      },
    });

    const orgB = await prisma.organization.findUnique({
      where: { clerk_org_id: "org_clerk_b" },
    });
    const user = await prisma.user.findUnique({
      where: { clerk_user_id: "user_clerk_1" },
    });
    expect(user?.org_id).toBe(orgB?.id);
    expect(user?.role).toBe("OrgAdmin");
  });
});

describe("applyClerkMembershipDeleted", () => {
  it("soft-deletes the user when removed from an org", async () => {
    const org = await prisma.organization.create({
      data: {
        clerk_org_id: "org_clerk_1",
        name: "Org",
        seat_limit: 5,
        quota_daily: 10,
        quota_monthly: 100,
      },
    });
    const user = await prisma.user.create({
      data: {
        org_id: org.id,
        clerk_user_id: "user_clerk_1",
        email: "remove@example.com",
        role: "Learner",
      },
    });

    await applyClerkMembershipDeleted({
      id: "mem_1",
      role: "org:basic_member",
      organization: { id: "org_clerk_1", name: "Org" },
      public_user_data: {
        user_id: "user_clerk_1",
        identifier: "remove@example.com",
        first_name: null,
        last_name: null,
      },
    });

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after?.deleted_at).not.toBeNull();
  });
});
