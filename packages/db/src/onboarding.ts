// Onboarding-wizard DB helpers (ADR-0017 Phase 5).
//
// The flow:
//   1. OrgAdmin lands on /onboarding/plan because their Org is
//      subscription_status=PendingPayment.
//   2. They pick a Plan card. The server action calls one of:
//        - activateFreePlanForOrg            (Free plan, no Stripe)
//        - ensureStripeCustomerIdForOrg
//          + create Checkout Session         (paid plan, hosted Stripe UI)
//   3. Stripe webhook (Phase 4) flips the Org into Trialing/Active.
//
// All helpers refuse to act unless the caller's Org is in
// PendingPayment and the caller is either the billing-owner (if set) or
// any OrgAdmin in the Org (when billing_owner_user_id is null — typical
// for invite-flow Orgs before the first sign-in).

import { Prisma } from "@prisma/client";
import { prisma } from "./client";
import type { OrgContext } from "./tenancy";
import { FREE_PLAN_SLUG, INTERNAL_PLAN_SLUG } from "./plans";

export type OnboardingFailureReason =
  | "plan_not_found"
  | "plan_inactive"
  | "plan_internal"
  | "plan_not_synced"
  | "plan_not_free"
  | "org_not_found"
  | "org_not_pending"
  | "not_billing_owner";

export type ActivateFreeResult =
  | { ok: true; org_id: string; plan_slug: string }
  | { ok: false; reason: OnboardingFailureReason };

export type EnsureCustomerResult =
  | { ok: true; stripe_customer_id: string; created: boolean }
  | { ok: false; reason: OnboardingFailureReason };

type OrgLite = {
  id: string;
  status: "Active" | "Suspended" | "Archived";
  subscription_status:
    | "PendingPayment"
    | "Trialing"
    | "Active"
    | "PastDue"
    | "Canceled"
    | "Incomplete"
    | "Internal";
  stripe_customer_id: string | null;
  billing_owner_user_id: string | null;
  name: string;
};

async function loadOrg(orgId: string): Promise<OrgLite | null> {
  return prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      status: true,
      subscription_status: true,
      stripe_customer_id: true,
      billing_owner_user_id: true,
      name: true,
    },
  });
}

function checkOrgPending(
  org: OrgLite | null,
  ctx: OrgContext,
): OnboardingFailureReason | null {
  if (!org) return "org_not_found";
  if (org.subscription_status !== "PendingPayment") return "org_not_pending";
  if (
    org.billing_owner_user_id !== null &&
    org.billing_owner_user_id !== ctx.user_id
  ) {
    return "not_billing_owner";
  }
  return null;
}

// ─── Free plan: activate locally, no Stripe ─────────────────────────────

export async function activateFreePlanForOrg(
  ctx: OrgContext,
  planId: string,
): Promise<ActivateFreeResult> {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) return { ok: false, reason: "plan_not_found" };
  if (!plan.is_active) return { ok: false, reason: "plan_inactive" };
  if (plan.is_internal || plan.slug === INTERNAL_PLAN_SLUG) {
    return { ok: false, reason: "plan_internal" };
  }
  const amountStr = plan.amount_monthly_usd.toString();
  // Free = amount 0. Anything paid MUST go through Stripe Checkout, so
  // we refuse here to keep the wizard from silently bypassing payment.
  if (amountStr !== "0" && amountStr !== "0.00") {
    return { ok: false, reason: "plan_not_free" };
  }

  const org = await loadOrg(ctx.org_id);
  const gate = checkOrgPending(org, ctx);
  if (gate) return { ok: false, reason: gate };

  // org is non-null because checkOrgPending returned null.
  await prisma.$transaction([
    prisma.organization.update({
      where: { id: org!.id },
      data: {
        plan_id: plan.id,
        subscription_status: "Internal",
        status: "Active",
        seat_limit: plan.seat_limit,
        quota_daily: plan.quota_daily,
        quota_monthly: plan.quota_monthly,
      },
    }),
    prisma.activityLog.create({
      data: {
        org_id: org!.id,
        user_id: ctx.user_id,
        action: "subscription.activated",
        metadata: {
          plan_slug: plan.slug,
          via: plan.slug === FREE_PLAN_SLUG ? "free_plan" : "free_amount",
        } as Prisma.InputJsonValue,
      },
    }),
  ]);

  return { ok: true, org_id: org!.id, plan_slug: plan.slug };
}

// ─── Stripe Customer: lazy create + stamp on Org ────────────────────────

// Caller injects the actual Stripe-SDK call so this helper stays
// independent of the SDK (mirrors the plan-sync injection pattern).
export type CreateStripeCustomerFn = (params: {
  email: string;
  name: string;
  metadata: Record<string, string>;
}) => Promise<{ id: string }>;

export async function ensureStripeCustomerIdForOrg(
  ctx: OrgContext,
  createCustomer: CreateStripeCustomerFn,
): Promise<EnsureCustomerResult> {
  const org = await loadOrg(ctx.org_id);
  const gate = checkOrgPending(org, ctx);
  if (gate) return { ok: false, reason: gate };

  if (org!.stripe_customer_id) {
    return {
      ok: true,
      stripe_customer_id: org!.stripe_customer_id,
      created: false,
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: ctx.user_id },
    select: { id: true, email: true, name: true },
  });
  if (!user) return { ok: false, reason: "org_not_found" };

  const created = await createCustomer({
    email: user.email,
    name: org!.name,
    metadata: {
      org_id: org!.id,
      billing_owner_user_id: ctx.user_id,
    },
  });

  await prisma.organization.update({
    where: { id: org!.id },
    data: {
      stripe_customer_id: created.id,
      // Stamp billing-owner now if it wasn't already set — first OrgAdmin
      // to hit Checkout becomes the billing owner. Phase 7's portal
      // surface keys off this field.
      billing_owner_user_id: org!.billing_owner_user_id ?? ctx.user_id,
    },
  });

  return { ok: true, stripe_customer_id: created.id, created: true };
}
