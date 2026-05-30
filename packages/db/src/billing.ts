// /admin/billing read helpers (ADR-0017 Phase 7).
//
// Pulls the data the OrgAdmin's billing surface needs in one shot:
//   - Org + Plan + subscription state
//   - Active learner count vs seat_limit
//   - Org-wide AI usage today + month-to-date
//   - Billing owner identity (so the page can disable "Manage billing"
//     for non-owners and tell them who to ask)
//
// All reads go through withOrg(ctx) so a tampered ctx (or a learner who
// somehow gets here) can never see another org's billing state.

import type { Organization, Plan, SubscriptionStatus, OrgStatus } from "@prisma/client";
import { prisma } from "./client";
import { withOrg, type OrgContext } from "./tenancy";

export type OrgBillingPlan = Pick<
  Plan,
  | "id"
  | "slug"
  | "name"
  | "description"
  | "amount_monthly_usd"
  | "trial_days"
  | "is_internal"
  | "stripe_price_id_monthly"
>;

export type OrgBillingSnapshot = {
  org: Pick<
    Organization,
    | "id"
    | "name"
    | "seat_limit"
    | "quota_daily"
    | "quota_monthly"
    | "subscription_status"
    | "status"
    | "trial_end"
    | "current_period_end"
    | "billing_owner_user_id"
    | "stripe_customer_id"
    | "stripe_subscription_id"
    | "provisioned_via"
  >;
  plan: OrgBillingPlan | null;
  active_learner_count: number;
  ai_usage_today: number;
  ai_usage_month_to_date: number;
  is_billing_owner: boolean;
  billing_owner: { email: string; name: string | null } | null;
};

function startOfUtcToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function startOfUtcMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getOrgBillingSnapshot(
  ctx: OrgContext,
): Promise<OrgBillingSnapshot> {
  // The Organization row carries the plan + Stripe IDs. Plan is global
  // (NOT tenant-scoped) so we read it via raw prisma; the Org read
  // itself sits behind withOrg(ctx) because Organization rows ARE
  // technically a global model but the lookup is scoped to ctx.org_id
  // via the unique id.
  const orgRow = await prisma.organization.findUnique({
    where: { id: ctx.org_id },
    select: {
      id: true,
      name: true,
      seat_limit: true,
      quota_daily: true,
      quota_monthly: true,
      subscription_status: true,
      status: true,
      trial_end: true,
      current_period_end: true,
      billing_owner_user_id: true,
      stripe_customer_id: true,
      stripe_subscription_id: true,
      provisioned_via: true,
      plan_id: true,
    },
  });
  if (!orgRow) {
    throw new Error(
      `OrgBillingSnapshot: org ${ctx.org_id} not found (auth gate should have caught this)`,
    );
  }

  const planPromise = orgRow.plan_id
    ? prisma.plan.findUnique({
        where: { id: orgRow.plan_id },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          amount_monthly_usd: true,
          trial_days: true,
          is_internal: true,
          stripe_price_id_monthly: true,
        },
      })
    : Promise.resolve(null);

  const db = withOrg(ctx);
  const today = startOfUtcToday();
  const monthStart = startOfUtcMonth();

  const [plan, learnerCount, todayUsage, monthUsage, billingOwner] =
    await Promise.all([
      planPromise,
      db.user.count({
        where: { role: "Learner", deleted_at: null },
      }),
      db.quotaUsage.aggregate({
        _sum: { ai_calls_count: true },
        where: { date: today },
      }),
      db.quotaUsage.aggregate({
        _sum: { ai_calls_count: true },
        where: { date: { gte: monthStart } },
      }),
      orgRow.billing_owner_user_id
        ? db.user.findUnique({
            where: { id: orgRow.billing_owner_user_id },
            select: { email: true, name: true },
          })
        : Promise.resolve(null),
    ]);

  return {
    org: orgRow,
    plan: plan ?? null,
    active_learner_count: learnerCount,
    ai_usage_today: todayUsage._sum.ai_calls_count ?? 0,
    ai_usage_month_to_date: monthUsage._sum.ai_calls_count ?? 0,
    is_billing_owner:
      orgRow.billing_owner_user_id !== null &&
      orgRow.billing_owner_user_id === ctx.user_id,
    billing_owner: billingOwner,
  };
}

// Convenience: the set of subscription statuses where the "Manage
// billing" portal makes sense. Free / Internal orgs have no Stripe
// customer, so the portal would fail.
export const PORTAL_ELIGIBLE_STATUSES: ReadonlySet<SubscriptionStatus> =
  new Set<SubscriptionStatus>([
    "Trialing",
    "Active",
    "PastDue",
    "Incomplete",
    "Canceled",
  ]);

// Convenience: human-readable label for the status badge.
export function subscriptionStatusLabel(
  status: SubscriptionStatus,
): string {
  switch (status) {
    case "Trialing":
      return "Trial";
    case "Active":
      return "Active";
    case "PastDue":
      return "Past due";
    case "Canceled":
      return "Canceled";
    case "Incomplete":
      return "Incomplete";
    case "Internal":
      return "Free / Internal";
    case "PendingPayment":
      return "Pending payment";
  }
}

export function orgStatusLabel(status: OrgStatus): string {
  return status;
}
