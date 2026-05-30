import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./client";
import { provisionSelfServeOrg } from "./self-serve";
import { resetDatabase } from "./test-helpers";
import { SYSTEM_ORG_ID, SYSTEM_ORG_NAME } from "./system-org";

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
      sort_order: 20,
      stripe_product_id: "prod_test_starter",
      stripe_price_id_monthly: "price_test_starter_monthly",
    },
  });
}

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
      sort_order: 10,
    },
  });
}

function buildClerkStubs() {
  let clerkOrgSeq = 0;
  const createClerkOrg = vi.fn(async (params: { name: string; createdBy: string }) => {
    clerkOrgSeq += 1;
    return { id: `org_test_${clerkOrgSeq}` };
  });
  const createClerkOrgMembership = vi.fn(async () => undefined);
  const deleteClerkOrg = vi.fn(async () => undefined);
  return { createClerkOrg, createClerkOrgMembership, deleteClerkOrg };
}

beforeEach(async () => {
  await resetDatabase();
  await ensureSystemOrg();
});

describe("provisionSelfServeOrg — paid plan", () => {
  it("creates Org + OrgAdmin + Clerk Org, stamps billing_owner, logs both org and super activity", async () => {
    await seedPaidPlan();
    const stubs = buildClerkStubs();

    const result = await provisionSelfServeOrg(
      {
        clerk_user_id: "user_test_visitor",
        email: "founder@acme.test",
        org_name: "Acme English Academy",
        plan_slug: "starter",
        user_name: "Alex Founder",
      },
      stubs,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subscription_status).toBe("PendingPayment");

    expect(stubs.createClerkOrg).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Acme English Academy",
        createdBy: "user_test_visitor",
      }),
    );
    expect(stubs.createClerkOrgMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_test_visitor",
        role: "org:admin",
      }),
    );

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: result.org_id },
    });
    expect(org).toMatchObject({
      subscription_status: "PendingPayment",
      provisioned_via: "self_serve",
      seat_limit: 25,
      quota_daily: 50,
      quota_monthly: 1000,
      billing_owner_user_id: result.user_id,
    });
    expect(org.clerk_org_id).toMatch(/^org_test_/);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: result.user_id },
    });
    expect(user).toMatchObject({
      org_id: org.id,
      email: "founder@acme.test",
      role: "OrgAdmin",
      clerk_user_id: "user_test_visitor",
    });

    const orgLog = await prisma.activityLog.findFirst({
      where: { org_id: org.id, action: "org.self_serve_created" },
    });
    expect(orgLog).not.toBeNull();
    const superLog = await prisma.activityLog.findFirst({
      where: {
        org_id: SYSTEM_ORG_ID,
        action: "super.org.self_serve_created",
      },
    });
    expect(superLog).not.toBeNull();
  });
});

describe("provisionSelfServeOrg — Free plan", () => {
  it("marks subscription_status=Internal so the wizard skips Stripe", async () => {
    await seedFreePlan();
    const stubs = buildClerkStubs();

    const result = await provisionSelfServeOrg(
      {
        clerk_user_id: "user_test_free",
        email: "indie@free.test",
        org_name: "Indie Tutor",
        plan_slug: "free",
      },
      stubs,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subscription_status).toBe("Internal");

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: result.org_id },
    });
    expect(org.subscription_status).toBe("Internal");
  });
});

describe("provisionSelfServeOrg — refusals", () => {
  it("refuses when email is already in our DB (no multi-org until Phase 0)", async () => {
    await seedPaidPlan();
    // Pre-existing user in another Org.
    const other = await prisma.organization.create({
      data: {
        name: "Existing Org",
        seat_limit: 10,
        quota_daily: 50,
        quota_monthly: 300,
      },
    });
    await prisma.user.create({
      data: {
        org_id: other.id,
        email: "founder@acme.test",
        role: "Learner",
      },
    });

    const stubs = buildClerkStubs();
    const result = await provisionSelfServeOrg(
      {
        clerk_user_id: "user_test_dup",
        email: "founder@acme.test",
        org_name: "Second Org",
        plan_slug: "starter",
      },
      stubs,
    );
    expect(result).toEqual({ ok: false, reason: "email_already_in_use" });
    expect(stubs.createClerkOrg).not.toHaveBeenCalled();
  });

  it("refuses when plan slug is unknown", async () => {
    const stubs = buildClerkStubs();
    const result = await provisionSelfServeOrg(
      {
        clerk_user_id: "user_test_noplan",
        email: "fresh@example.test",
        org_name: "Acme",
        plan_slug: "ghost-plan",
      },
      stubs,
    );
    expect(result).toEqual({ ok: false, reason: "plan_not_found" });
    expect(stubs.createClerkOrg).not.toHaveBeenCalled();
  });

  it("refuses an internal plan and never hits Clerk", async () => {
    await prisma.plan.create({
      data: {
        slug: "internal",
        name: "Internal",
        seat_limit: 1000,
        quota_daily: 5000,
        quota_monthly: 100000,
        amount_monthly_usd: "0.00",
        trial_days: 0,
        is_internal: true,
        sort_order: 1000,
      },
    });
    const stubs = buildClerkStubs();
    const result = await provisionSelfServeOrg(
      {
        clerk_user_id: "user_test_internal",
        email: "fresh@example.test",
        org_name: "Acme",
        plan_slug: "internal",
      },
      stubs,
    );
    expect(result).toEqual({ ok: false, reason: "plan_internal" });
    expect(stubs.createClerkOrg).not.toHaveBeenCalled();
  });

  it("cleans up the Clerk Org if DB writes fail after Clerk creation succeeded", async () => {
    await seedPaidPlan();
    // Sabotage: create a user with the same clerk_user_id BEFORE the
    // provision so the inner DB write hits a unique-constraint failure.
    const stubs = buildClerkStubs();
    const otherOrg = await prisma.organization.create({
      data: {
        name: "Other",
        seat_limit: 10,
        quota_daily: 50,
        quota_monthly: 300,
      },
    });
    await prisma.user.create({
      data: {
        org_id: otherOrg.id,
        email: "blocker@example.test",
        clerk_user_id: "user_test_collide",
        role: "Learner",
      },
    });

    const result = await provisionSelfServeOrg(
      {
        clerk_user_id: "user_test_collide",
        email: "fresh@example.test",
        org_name: "Acme",
        plan_slug: "starter",
      },
      stubs,
    );
    // The early-out catches this BEFORE Clerk Org create because
    // existingByClerk fires first. Reason should be email_already_in_use
    // (the canonical "you already have an account" outcome).
    expect(result).toEqual({ ok: false, reason: "email_already_in_use" });
    expect(stubs.createClerkOrg).not.toHaveBeenCalled();
  });

  it("returns invalid_org_name for too-short names", async () => {
    await seedPaidPlan();
    const stubs = buildClerkStubs();
    const result = await provisionSelfServeOrg(
      {
        clerk_user_id: "user_test_shortname",
        email: "fresh@example.test",
        org_name: "x",
        plan_slug: "starter",
      },
      stubs,
    );
    expect(result).toEqual({ ok: false, reason: "invalid_org_name" });
  });
});
