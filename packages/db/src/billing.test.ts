import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import {
  PORTAL_ELIGIBLE_STATUSES,
  getOrgBillingSnapshot,
  subscriptionStatusLabel,
} from "./billing";
import type { OrgContext } from "./tenancy";
import { resetDatabase } from "./test-helpers";

beforeEach(async () => {
  await resetDatabase();
});

async function seedPlan(slug: string, amount: string) {
  return prisma.plan.create({
    data: {
      slug,
      name: slug,
      seat_limit: 25,
      quota_daily: 50,
      quota_monthly: 1000,
      amount_monthly_usd: amount,
      trial_days: 14,
      is_internal: false,
      is_active: true,
      sort_order: 100,
      stripe_product_id: amount === "0.00" ? null : "prod_seed",
      stripe_price_id_monthly: amount === "0.00" ? null : "price_seed",
    },
  });
}

let orgSeq = 0;

async function seedOrgAndAdmins(opts: {
  plan_id: string;
  subscription_status?:
    | "PendingPayment"
    | "Trialing"
    | "Active"
    | "Internal"
    | "PastDue";
  trial_end?: Date | null;
  stripe_customer_id?: string | null;
  seat_limit?: number;
}) {
  orgSeq += 1;
  const tag = `seed${orgSeq}`;
  const org = await prisma.organization.create({
    data: {
      name: `Acme English ${tag}`,
      seat_limit: opts.seat_limit ?? 25,
      quota_daily: 50,
      quota_monthly: 1000,
      status: "Active",
      subscription_status: opts.subscription_status ?? "Trialing",
      stripe_customer_id: opts.stripe_customer_id ?? `cus_${tag}`,
      plan_id: opts.plan_id,
      trial_end: opts.trial_end ?? null,
    },
  });
  const owner = await prisma.user.create({
    data: {
      org_id: org.id,
      email: `owner-${tag}@acme.test`,
      name: "Acme Owner",
      role: "OrgAdmin",
    },
  });
  const otherAdmin = await prisma.user.create({
    data: {
      org_id: org.id,
      email: `second-${tag}@acme.test`,
      role: "OrgAdmin",
    },
  });
  await prisma.organization.update({
    where: { id: org.id },
    data: { billing_owner_user_id: owner.id },
  });
  return { org, owner, otherAdmin };
}

function ctxFor(orgId: string, userId: string): OrgContext {
  return { org_id: orgId, user_id: userId, role: "OrgAdmin" };
}

describe("getOrgBillingSnapshot", () => {
  it("returns plan + seat usage + AI usage for the caller's Org", async () => {
    const plan = await seedPlan("starter", "49.00");
    const { org, owner } = await seedOrgAndAdmins({
      plan_id: plan.id,
      seat_limit: 5,
      trial_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });
    // Three active learners.
    for (let i = 0; i < 3; i += 1) {
      await prisma.user.create({
        data: {
          org_id: org.id,
          email: `learner-${i}@acme.test`,
          role: "Learner",
        },
      });
    }
    // One soft-deleted learner — should NOT count.
    await prisma.user.create({
      data: {
        org_id: org.id,
        email: "left@acme.test",
        role: "Learner",
        deleted_at: new Date(),
      },
    });
    // AI usage today + month.
    const today = new Date();
    const startOfDay = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    await prisma.quotaUsage.create({
      data: {
        org_id: org.id,
        user_id: owner.id,
        date: startOfDay,
        ai_calls_count: 42,
      },
    });
    const earlierInMonth = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );
    // Different day this month — only counts in month total, not today.
    if (earlierInMonth.getTime() !== startOfDay.getTime()) {
      await prisma.quotaUsage.create({
        data: {
          org_id: org.id,
          user_id: owner.id,
          date: earlierInMonth,
          ai_calls_count: 100,
        },
      });
    }

    const snapshot = await getOrgBillingSnapshot(ctxFor(org.id, owner.id));
    expect(snapshot.org.id).toBe(org.id);
    expect(snapshot.plan?.slug).toBe("starter");
    expect(snapshot.active_learner_count).toBe(3);
    expect(snapshot.ai_usage_today).toBe(42);
    expect(snapshot.ai_usage_month_to_date).toBeGreaterThanOrEqual(42);
    expect(snapshot.is_billing_owner).toBe(true);
    expect(snapshot.billing_owner?.email).toBe(owner.email);
  });

  it("flags is_billing_owner=false for non-owner OrgAdmins", async () => {
    const plan = await seedPlan("starter", "49.00");
    const { org, owner, otherAdmin } = await seedOrgAndAdmins({
      plan_id: plan.id,
    });

    const snapshot = await getOrgBillingSnapshot(ctxFor(org.id, otherAdmin.id));
    expect(snapshot.is_billing_owner).toBe(false);
    expect(snapshot.billing_owner?.email).toBe(owner.email);
  });

  it("does not leak another org's data even with a crafted ctx", async () => {
    const plan = await seedPlan("starter", "49.00");
    const orgA = await seedOrgAndAdmins({
      plan_id: plan.id,
      stripe_customer_id: "cus_acme_a",
    });
    const orgB = await seedOrgAndAdmins({
      plan_id: plan.id,
      stripe_customer_id: "cus_acme_b",
    });
    // Learners in orgB shouldn't affect orgA's snapshot.
    for (let i = 0; i < 7; i += 1) {
      await prisma.user.create({
        data: {
          org_id: orgB.org.id,
          email: `learner-b-${i}@b.test`,
          role: "Learner",
        },
      });
    }
    const snapshot = await getOrgBillingSnapshot(
      ctxFor(orgA.org.id, orgA.owner.id),
    );
    expect(snapshot.active_learner_count).toBe(0);
  });
});

describe("subscriptionStatusLabel", () => {
  it.each([
    ["Trialing", "Trial"],
    ["Active", "Active"],
    ["PastDue", "Past due"],
    ["Canceled", "Canceled"],
    ["Internal", "Free / Internal"],
    ["PendingPayment", "Pending payment"],
  ])("maps %s → %s", (status, expected) => {
    expect(subscriptionStatusLabel(status as never)).toBe(expected);
  });
});

describe("PORTAL_ELIGIBLE_STATUSES", () => {
  it("excludes Internal and PendingPayment (no Stripe customer)", () => {
    expect(PORTAL_ELIGIBLE_STATUSES.has("Internal")).toBe(false);
    expect(PORTAL_ELIGIBLE_STATUSES.has("PendingPayment")).toBe(false);
    expect(PORTAL_ELIGIBLE_STATUSES.has("Trialing")).toBe(true);
    expect(PORTAL_ELIGIBLE_STATUSES.has("Active")).toBe(true);
    expect(PORTAL_ELIGIBLE_STATUSES.has("PastDue")).toBe(true);
  });
});
