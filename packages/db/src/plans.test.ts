import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import {
  archivePlanAsSuperAdmin,
  createPlanAsSuperAdmin,
  getPlanByIdAsSuperAdmin,
  getPlanBySlugAsSuperAdmin,
  INTERNAL_PLAN_SLUG,
  listPlansAsSuperAdmin,
  updatePlanAsSuperAdmin,
} from "./plans";
import { SYSTEM_ORG_ID, SYSTEM_ORG_NAME } from "./system-org";
import { TENANT_SCOPED_MODELS } from "./tenancy";
import { createTestOrg, resetDatabase } from "./test-helpers";

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

async function superCtx() {
  const orgA = await createTestOrg("PlanSup");
  return {
    org_id: orgA.id,
    user_id: orgA.adminId,
    role: "SuperAdmin" as const,
  };
}

async function seedInternalPlan() {
  return prisma.plan.create({
    data: {
      slug: INTERNAL_PLAN_SLUG,
      name: "Internal",
      seat_limit: 1000,
      quota_daily: 5000,
      quota_monthly: 100000,
      amount_monthly_usd: "0.00",
      trial_days: 0,
      is_internal: true,
      is_active: true,
      sort_order: 1000,
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  await ensureSystemOrg();
});

describe("Plan is global, not tenant-scoped", () => {
  it("is NOT listed in TENANT_SCOPED_MODELS", () => {
    // The tenancy fuzzer cross-checks the live datamodel against this set.
    // Plan is a global model (like Test) — adding it here would break the
    // SuperAdmin's cross-org access via withSuperAdminContext().
    expect(TENANT_SCOPED_MODELS.has("Plan" as never)).toBe(false);
  });
});

describe("createPlanAsSuperAdmin", () => {
  it("creates a Plan with normalized amount and writes super.plan.created log", async () => {
    const ctx = await superCtx();

    const result = await createPlanAsSuperAdmin(ctx, {
      slug: "starter",
      name: "Starter",
      description: "Small schools.",
      seat_limit: 25,
      quota_daily: 50,
      quota_monthly: 1000,
      amount_monthly_usd: "49",
      trial_days: 14,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toMatchObject({
      slug: "starter",
      name: "Starter",
      seat_limit: 25,
      trial_days: 14,
      is_internal: false,
      is_active: true,
    });
    // Decimal column comes back as a Prisma Decimal — compare via toString.
    expect(result.value.amount_monthly_usd.toString()).toBe("49");

    const logs = await prisma.activityLog.findMany({
      where: { org_id: SYSTEM_ORG_ID, action: "super.plan.created" },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.metadata).toMatchObject({ slug: "starter" });
  });

  it("returns slug_taken on the second create with the same slug", async () => {
    const ctx = await superCtx();

    const first = await createPlanAsSuperAdmin(ctx, {
      slug: "pro",
      name: "Pro",
      seat_limit: 100,
      quota_daily: 100,
      quota_monthly: 3000,
      amount_monthly_usd: "199.00",
      trial_days: 14,
    });
    expect(first.ok).toBe(true);

    const second = await createPlanAsSuperAdmin(ctx, {
      slug: "pro",
      name: "Pro Duplicate",
      seat_limit: 50,
      quota_daily: 50,
      quota_monthly: 1500,
      amount_monthly_usd: "99.00",
      trial_days: 7,
    });
    expect(second).toEqual({ ok: false, reason: "slug_taken" });
  });

  it.each([
    [
      "invalid_slug",
      { slug: "Bad Slug!" },
    ],
    [
      "invalid_name",
      { name: "x" },
    ],
    [
      "invalid_amount",
      { amount_monthly_usd: "-1" },
    ],
    [
      "invalid_trial_days",
      { trial_days: 9999 },
    ],
    [
      "invalid_seat_limit",
      { seat_limit: 0 },
    ],
  ])("rejects with %s", async (reason, overrides) => {
    const ctx = await superCtx();
    const base = {
      slug: "valid-slug",
      name: "Valid Name",
      seat_limit: 10,
      quota_daily: 50,
      quota_monthly: 300,
      amount_monthly_usd: "10.00",
      trial_days: 14,
    };
    const result = await createPlanAsSuperAdmin(ctx, { ...base, ...overrides });
    expect(result).toEqual({ ok: false, reason });
  });
});

describe("updatePlanAsSuperAdmin", () => {
  it("updates mutable fields and logs the changed keys", async () => {
    const ctx = await superCtx();
    const created = await createPlanAsSuperAdmin(ctx, {
      slug: "edit-me",
      name: "Edit Me",
      seat_limit: 10,
      quota_daily: 50,
      quota_monthly: 500,
      amount_monthly_usd: "29.00",
      trial_days: 14,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updatePlanAsSuperAdmin(ctx, created.value.id, {
      name: "Renamed",
      amount_monthly_usd: "39.00",
      seat_limit: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.name).toBe("Renamed");
    expect(result.value.amount_monthly_usd.toString()).toBe("39");
    expect(result.value.seat_limit).toBe(20);

    const logs = await prisma.activityLog.findMany({
      where: { org_id: SYSTEM_ORG_ID, action: "super.plan.updated" },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.metadata).toMatchObject({
      plan_id: created.value.id,
      changed: expect.arrayContaining(["name", "amount_monthly_usd", "seat_limit"]),
    });
  });

  it("returns internal_plan_immutable when targeting the internal plan", async () => {
    const ctx = await superCtx();
    const internal = await seedInternalPlan();

    const result = await updatePlanAsSuperAdmin(ctx, internal.id, {
      name: "Hijacked",
    });
    expect(result).toEqual({
      ok: false,
      reason: "internal_plan_immutable",
    });
  });

  it("returns plan_not_found for an unknown id", async () => {
    const ctx = await superCtx();
    const result = await updatePlanAsSuperAdmin(ctx, "plan_does_not_exist", {
      name: "x",
    });
    expect(result).toEqual({ ok: false, reason: "plan_not_found" });
  });
});

describe("archivePlanAsSuperAdmin", () => {
  it("flips is_active=false and logs super.plan.archived", async () => {
    const ctx = await superCtx();
    const created = await createPlanAsSuperAdmin(ctx, {
      slug: "to-archive",
      name: "To Archive",
      seat_limit: 5,
      quota_daily: 25,
      quota_monthly: 150,
      amount_monthly_usd: "9.00",
      trial_days: 0,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await archivePlanAsSuperAdmin(ctx, created.value.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.is_active).toBe(false);

    const logs = await prisma.activityLog.findMany({
      where: { org_id: SYSTEM_ORG_ID, action: "super.plan.archived" },
    });
    expect(logs).toHaveLength(1);
  });

  it("refuses to archive the internal plan", async () => {
    const ctx = await superCtx();
    const internal = await seedInternalPlan();

    const result = await archivePlanAsSuperAdmin(ctx, internal.id);
    expect(result).toEqual({
      ok: false,
      reason: "internal_plan_immutable",
    });
  });
});

describe("listPlansAsSuperAdmin", () => {
  it("returns active plans by default, includes inactive on opt-in", async () => {
    const ctx = await superCtx();
    const active = await createPlanAsSuperAdmin(ctx, {
      slug: "active-one",
      name: "Active One",
      seat_limit: 10,
      quota_daily: 50,
      quota_monthly: 300,
      amount_monthly_usd: "0",
      trial_days: 0,
    });
    expect(active.ok).toBe(true);
    if (!active.ok) return;

    const dormant = await createPlanAsSuperAdmin(ctx, {
      slug: "dormant-one",
      name: "Dormant One",
      seat_limit: 10,
      quota_daily: 50,
      quota_monthly: 300,
      amount_monthly_usd: "0",
      trial_days: 0,
    });
    expect(dormant.ok).toBe(true);
    if (!dormant.ok) return;
    await archivePlanAsSuperAdmin(ctx, dormant.value.id);

    const defaultList = await listPlansAsSuperAdmin(ctx);
    const slugsDefault = defaultList.map((p) => p.slug);
    expect(slugsDefault).toContain("active-one");
    expect(slugsDefault).not.toContain("dormant-one");

    const allList = await listPlansAsSuperAdmin(ctx, { includeInactive: true });
    const slugsAll = allList.map((p) => p.slug);
    expect(slugsAll).toEqual(expect.arrayContaining(["active-one", "dormant-one"]));
  });
});

describe("getPlanBySlugAsSuperAdmin", () => {
  it("returns null for an invalid slug shape (defence against form tampering)", async () => {
    const ctx = await superCtx();
    const result = await getPlanBySlugAsSuperAdmin(ctx, "Not A Slug!");
    expect(result).toBeNull();
  });

  it("returns the plan row by id and by slug", async () => {
    const ctx = await superCtx();
    const created = await createPlanAsSuperAdmin(ctx, {
      slug: "lookup-me",
      name: "Lookup Me",
      seat_limit: 5,
      quota_daily: 25,
      quota_monthly: 150,
      amount_monthly_usd: "5",
      trial_days: 0,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const byId = await getPlanByIdAsSuperAdmin(ctx, created.value.id);
    expect(byId?.slug).toBe("lookup-me");

    const bySlug = await getPlanBySlugAsSuperAdmin(ctx, "lookup-me");
    expect(bySlug?.id).toBe(created.value.id);
  });
});
