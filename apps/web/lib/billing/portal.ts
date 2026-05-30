"use server";

// Stripe Billing Portal entry point (ADR-0017 Phase 7 / D9).
//
// Only the Org's billing owner can open the portal — other OrgAdmins
// see /admin/billing read-only with the button disabled. Free /
// Internal orgs have no Stripe Customer and so cannot open the portal
// at all.

import { redirect } from "next/navigation";
import { getOrgBillingSnapshot } from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import { getStripe } from "@/lib/billing/stripe-client";

function resolveAppUrl(): string {
  const fromEnv = process.env.APP_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/+$/, "");
  return "http://localhost:3000";
}

export async function openBillingPortalFromForm(): Promise<void> {
  const ctx = await requireRole("OrgAdmin");
  const snapshot = await getOrgBillingSnapshot(ctx);

  if (!snapshot.is_billing_owner) {
    redirect("/admin/billing?error=not_billing_owner");
  }
  if (!snapshot.org.stripe_customer_id) {
    redirect("/admin/billing?error=no_stripe_customer");
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: snapshot.org.stripe_customer_id,
    return_url: `${resolveAppUrl()}/admin/billing`,
  });
  if (!session.url) {
    console.error("[billing] Stripe returned no Portal URL");
    redirect("/admin/billing?error=portal_failed");
  }
  redirect(session.url);
}
