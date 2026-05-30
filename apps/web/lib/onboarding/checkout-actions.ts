"use server";

// Onboarding wizard server actions (ADR-0017 Phase 5).
//
// `selectPlanFromForm` is the form-action that fires when an OrgAdmin
// clicks a tier card on /onboarding/plan. Two branches:
//
//   - Free plan (amount=0): activate locally, no Stripe round-trip.
//                            Redirect to /onboarding/welcome.
//   - Paid plan:            ensure Stripe Customer + create Checkout
//                            Session, 303-redirect to Stripe's hosted
//                            checkout URL. Stripe webhook (Phase 4)
//                            handles activation when the session
//                            completes.

import { redirect } from "next/navigation";
import {
  activateFreePlanForOrg,
  ensureStripeCustomerIdForOrg,
  getActivePlanByIdForCustomer,
} from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import { getStripe } from "@/lib/billing/stripe-client";

function resolveAppUrl(): string {
  const fromEnv = process.env.APP_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/+$/, "");
  // Last-resort fallback for `pnpm dev` if APP_URL isn't wired yet; the
  // Stripe success/cancel URLs must be absolute, so we never let this
  // become a relative URL.
  return "http://localhost:3000";
}

export async function selectPlanFromForm(formData: FormData): Promise<void> {
  const ctx = await requireRole("OrgAdmin");
  const planIdRaw = formData.get("plan_id");
  const planId =
    typeof planIdRaw === "string" && planIdRaw.length > 0 ? planIdRaw : null;
  if (!planId) redirect("/onboarding/plan?error=plan_not_found");

  const plan = await getActivePlanByIdForCustomer(planId);
  if (!plan) redirect("/onboarding/plan?error=plan_not_found");

  // Free plan: skip Stripe entirely (ADR-0017 D4).
  const amountStr = plan.amount_monthly_usd.toString();
  if (amountStr === "0" || amountStr === "0.00") {
    const result = await activateFreePlanForOrg(ctx, plan.id);
    if (!result.ok) {
      redirect(`/onboarding/plan?error=${result.reason}`);
    }
    redirect("/onboarding/welcome");
  }

  // Paid plan: must have Stripe sync completed (Phase 2). If not, point
  // SuperAdmin to /plans/[planId] to re-sync.
  if (!plan.stripe_price_id_monthly) {
    redirect("/onboarding/plan?error=plan_not_synced");
  }

  const stripe = getStripe();
  const customer = await ensureStripeCustomerIdForOrg(ctx, async (params) => {
    const created = await stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: params.metadata,
    });
    return { id: created.id };
  });
  if (!customer.ok) {
    redirect(`/onboarding/plan?error=${customer.reason}`);
  }

  const appUrl = resolveAppUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customer.stripe_customer_id,
    line_items: [{ price: plan.stripe_price_id_monthly, quantity: 1 }],
    subscription_data: {
      // trial_period_days=0 throws — only set when the plan has a trial.
      trial_period_days: plan.trial_days > 0 ? plan.trial_days : undefined,
      metadata: { org_id: ctx.org_id, plan_slug: plan.slug },
    },
    metadata: { org_id: ctx.org_id, plan_slug: plan.slug },
    success_url: `${appUrl}/onboarding/processing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/onboarding/plan?canceled=1`,
    allow_promotion_codes: false,
    billing_address_collection: "auto",
  });

  if (!session.url) {
    console.error("[checkout] Stripe returned no Checkout URL");
    redirect("/onboarding/plan?error=checkout_failed");
  }

  redirect(session.url);
}
