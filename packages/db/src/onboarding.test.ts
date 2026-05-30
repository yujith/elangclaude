import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./client";
import {
  activateFreePlanForOrg,
  ensureStripeCustomerIdForOrg,
} from "./onboarding";
import type { OrgContext } from "./tenancy";
import { resetDatabase } from "./test-helpers";

beforeEach(async () => {
  await resetDatabase();
});

async function seedFreePlan() {
  return prisma.plan.create({
    data: {
      slug: "free",
      name: "Free",
      seat_limit: 1,
      quota_daily: 50,
      quota_monthly: 300,
      amount_monthly_usd: "0.00",
      trial_days: 0,
      is_internal: false,
      is_active: true,
      sort_order: 10,
    },
  });
}

async function seedPaidPlan() {
  return prisma.plan.create({
    data: {
      slug: "starter",
      name: "Starter",
      seat_limit: 25,
      quota_daily: 50,
      quota_monthly: 1000,
      amount_monthly_usd: "49.00",
      trial_days: 14,
      is_internal: false,
      is_active: true,
      sort_order: 20,
    },
  });
}

async function seedOrgWithAdmin(
  overrides: {
    subscription_status?:
      | "PendingPayment"
      | "Trialing"
      | "Active"
      | "Internal";
    billing_owner_user_id?: string | null;
    stripe_customer_id?: string | null;
  } = {},
) {
  const org = await prisma.organization.create({
    data: {
      name: "Acme English",
      seat_limit: 10,
      quota_daily: 50,
      quota_monthly: 300,
      status: "Active",
      subscription_status: overrides.subscription_status ?? "PendingPayment",
      stripe_customer_id: overrides.stripe_customer_id ?? null,
      billing_owner_user_id: overrides.billing_owner_user_id ?? null,
    },
  });
  const admin = await prisma.user.create({
    data: {
      org_id: org.id,
      email: `admin-${Math.random().toString(16).slice(2, 8)}@elc.test`,
      name: "Acme Admin",
      role: "OrgAdmin",
    },
  });
  if (overrides.billing_owner_user_id === undefined) {
    // No-op — leave billing_owner_user_id null.
  }
  return { org, admin };
}

function ctxFor(orgId: string, userId: string): OrgContext {
  return { org_id: orgId, user_id: userId, role: "OrgAdmin" };
}

describe("activateFreePlanForOrg", () => {
  it("activates a PendingPayment Org locally and writes subscription.activated log", async () => {
    const plan = await seedFreePlan();
    const { org, admin } = await seedOrgWithAdmin();

    const result = await activateFreePlanForOrg(ctxFor(org.id, admin.id), plan.id);
    expect(result).toMatchObject({ ok: true, plan_slug: "free" });

    const refreshed = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(refreshed.subscription_status).toBe("Internal");
    expect(refreshed.status).toBe("Active");
    expect(refreshed.plan_id).toBe(plan.id);
    expect(refreshed.seat_limit).toBe(plan.seat_limit);
    expect(refreshed.quota_daily).toBe(plan.quota_daily);
    expect(refreshed.quota_monthly).toBe(plan.quota_monthly);

    const log = await prisma.activityLog.findFirst({
      where: { org_id: org.id, action: "subscription.activated" },
    });
    expect(log).not.toBeNull();
  });

  it("refuses when the Org is not PendingPayment", async () => {
    const plan = await seedFreePlan();
    const { org, admin } = await seedOrgWithAdmin({
      subscription_status: "Active",
    });

    const result = await activateFreePlanForOrg(ctxFor(org.id, admin.id), plan.id);
    expect(result).toEqual({ ok: false, reason: "org_not_pending" });
  });

  it("refuses when the plan amount is non-zero", async () => {
    const plan = await seedPaidPlan();
    const { org, admin } = await seedOrgWithAdmin();

    const result = await activateFreePlanForOrg(ctxFor(org.id, admin.id), plan.id);
    expect(result).toEqual({ ok: false, reason: "plan_not_free" });
  });

  it("refuses when the caller isn't the billing owner", async () => {
    const plan = await seedFreePlan();
    const { org, admin } = await seedOrgWithAdmin();
    await prisma.organization.update({
      where: { id: org.id },
      data: { billing_owner_user_id: admin.id },
    });
    const intruder = await prisma.user.create({
      data: {
        org_id: org.id,
        email: "intruder@elc.test",
        name: "Intruder",
        role: "OrgAdmin",
      },
    });

    const result = await activateFreePlanForOrg(
      ctxFor(org.id, intruder.id),
      plan.id,
    );
    expect(result).toEqual({ ok: false, reason: "not_billing_owner" });
  });
});

describe("ensureStripeCustomerIdForOrg", () => {
  it("creates a Stripe Customer when missing and stamps the id + billing owner", async () => {
    const { org, admin } = await seedOrgWithAdmin();
    const create = vi.fn(async (params: { email: string; name: string; metadata: Record<string, string> }) => ({
      id: `cus_test_${Math.random().toString(16).slice(2, 8)}`,
    }));

    const result = await ensureStripeCustomerIdForOrg(
      ctxFor(org.id, admin.id),
      create,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(result.stripe_customer_id).toMatch(/^cus_test_/);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: admin.email,
        name: org.name,
        metadata: expect.objectContaining({
          org_id: org.id,
          billing_owner_user_id: admin.id,
        }),
      }),
    );

    const refreshed = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(refreshed.stripe_customer_id).toBe(result.stripe_customer_id);
    expect(refreshed.billing_owner_user_id).toBe(admin.id);
  });

  it("reuses an existing stripe_customer_id (idempotent)", async () => {
    const { org, admin } = await seedOrgWithAdmin({
      stripe_customer_id: "cus_already_set",
    });
    const create = vi.fn();

    const result = await ensureStripeCustomerIdForOrg(
      ctxFor(org.id, admin.id),
      create as never,
    );
    expect(result).toMatchObject({
      ok: true,
      stripe_customer_id: "cus_already_set",
      created: false,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses when Org is not PendingPayment", async () => {
    const { org, admin } = await seedOrgWithAdmin({
      subscription_status: "Active",
    });
    const create = vi.fn();

    const result = await ensureStripeCustomerIdForOrg(
      ctxFor(org.id, admin.id),
      create as never,
    );
    expect(result).toEqual({ ok: false, reason: "org_not_pending" });
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses when caller is not the billing owner", async () => {
    const { org, admin } = await seedOrgWithAdmin();
    await prisma.organization.update({
      where: { id: org.id },
      data: { billing_owner_user_id: admin.id },
    });
    const intruder = await prisma.user.create({
      data: {
        org_id: org.id,
        email: "intruder@elc.test",
        name: "x",
        role: "OrgAdmin",
      },
    });
    const create = vi.fn();

    const result = await ensureStripeCustomerIdForOrg(
      ctxFor(org.id, intruder.id),
      create as never,
    );
    expect(result).toEqual({ ok: false, reason: "not_billing_owner" });
  });

  // ── Tenancy defence-in-depth (audit follow-up — F1) ─────────────────
  // The caller's User row is read via withOrg(ctx) so the proxy injects
  // org_id=ctx.org_id. A crafted ctx that pairs orgA's id with a User
  // row from orgB must miss the lookup and NOT leak orgB's email into
  // the Stripe Customer payload.
  it("does not leak another org's user email even with a crafted ctx", async () => {
    const orgA = await prisma.organization.create({
      data: {
        name: "Org A",
        seat_limit: 10,
        quota_daily: 50,
        quota_monthly: 300,
        status: "Active",
        subscription_status: "PendingPayment",
      },
    });
    // No User row in orgA — only an OrgAdmin in orgB.
    const orgB = await prisma.organization.create({
      data: {
        name: "Org B",
        seat_limit: 10,
        quota_daily: 50,
        quota_monthly: 300,
        status: "Active",
        subscription_status: "Active",
      },
    });
    const orgBAdmin = await prisma.user.create({
      data: {
        org_id: orgB.id,
        email: "elsewhere@orgb.test",
        name: "Org B Admin",
        role: "OrgAdmin",
      },
    });

    const create = vi.fn();
    const crafted: OrgContext = {
      org_id: orgA.id,
      user_id: orgBAdmin.id, // foreign user id smuggled into ctx
      role: "OrgAdmin",
    };

    const result = await ensureStripeCustomerIdForOrg(crafted, create);
    // Lookup misses because withOrg(ctx) injects org_id=orgA on the
    // User read, and orgBAdmin lives in orgB. We surface the same
    // "org_not_found" reason the missing-User path uses.
    expect(result).toEqual({ ok: false, reason: "org_not_found" });
    expect(create).not.toHaveBeenCalled();

    // OrgB's user row must be untouched.
    const orgBAdminAfter = await prisma.user.findUniqueOrThrow({
      where: { id: orgBAdmin.id },
    });
    expect(orgBAdminAfter.email).toBe("elsewhere@orgb.test");
    expect(orgBAdminAfter.org_id).toBe(orgB.id);

    // OrgA must not have inherited a Stripe customer.
    const orgAAfter = await prisma.organization.findUniqueOrThrow({
      where: { id: orgA.id },
    });
    expect(orgAAfter.stripe_customer_id).toBeNull();
    expect(orgAAfter.billing_owner_user_id).toBeNull();
  });
});
