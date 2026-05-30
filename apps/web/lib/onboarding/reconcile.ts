// Direct-from-Stripe reconciler for /onboarding/processing.
//
// The webhook (Phase 4) is the canonical activation path — when Stripe
// delivers `checkout.session.completed` and `customer.subscription.created`,
// our handler flips the Org from PendingPayment to Trialing/Active.
//
// But in dev (no `stripe listen` running, or a temporarily flaky tunnel)
// the webhook can be silent, and the OrgAdmin gets stuck on /processing
// forever. This helper bridges that gap: given the Checkout Session id
// in the URL (Stripe redirects us with it in `success_url`), we fetch
// the Session + Subscription from Stripe and run the same handler the
// webhook would. Result: the wizard completes even with no webhook
// delivery.
//
// Safety:
//   - We only act if the resolved Session's `customer` matches the
//     caller's Org `stripe_customer_id`. Anything else gets refused so
//     a forged session_id in the URL can never activate the wrong Org.
//   - We pass through the existing applyCustomerSubscriptionUpserted,
//     which has its own metadata.org_id + idempotency + ordering
//     guards (see packages/db/src/stripe-events.ts).

import {
  applyCustomerSubscriptionUpserted,
  type StripeEventEnvelope,
  type StripeSubscriptionEvent,
} from "@elc/db";
import { prisma } from "@elc/db/client";
import { getStripe } from "@/lib/billing/stripe-client";

export type ReconcileResult =
  | { kind: "applied"; subscription_status: string }
  | { kind: "no_subscription" }
  | { kind: "customer_mismatch" }
  | { kind: "session_not_found" }
  | { kind: "stripe_error"; message: string };

export async function reconcileFromCheckoutSession(
  orgId: string,
  sessionId: string,
): Promise<ReconcileResult> {
  if (!sessionId.startsWith("cs_")) {
    return { kind: "session_not_found" };
  }
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { stripe_customer_id: true },
  });
  if (!org) return { kind: "customer_mismatch" };

  const stripe = getStripe();
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session) return { kind: "session_not_found" };

    const sessionCustomer =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id ?? null;
    if (!sessionCustomer || sessionCustomer !== org.stripe_customer_id) {
      return { kind: "customer_mismatch" };
    }

    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id ?? null;
    if (!subscriptionId) {
      // Checkout completed but subscription not yet created — Stripe
      // returns this state briefly. The poll will retry.
      return { kind: "no_subscription" };
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const priceId = subscription.items?.data?.[0]?.price?.id ?? null;

    const event: StripeSubscriptionEvent = {
      id: subscription.id,
      customer:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id,
      // The Stripe TS types' status enum is a superset of what we
      // accept — cast keeps the package boundary clean.
      status: subscription.status as StripeSubscriptionEvent["status"],
      current_period_end:
        (subscription as unknown as { current_period_end?: number }).current_period_end ?? null,
      trial_end: subscription.trial_end ?? null,
      items: priceId ? { data: [{ price: { id: priceId } }] } : undefined,
      metadata: (subscription.metadata as Record<string, string> | null) ?? null,
    };

    // Synthetic envelope. The id is namespaced so it can never collide
    // with a real Stripe event id; the type matches what
    // applyCustomerSubscriptionUpserted expects. `created` uses the
    // Subscription's created time so the monotonic ordering guard
    // treats this no differently from a real webhook event.
    const envelope: StripeEventEnvelope = {
      id: `reconcile_${sessionId}_${subscription.id}`,
      type: "customer.subscription.created",
      created: subscription.created,
      data: { object: event },
    };

    const outcome = await applyCustomerSubscriptionUpserted(envelope, event);
    if (outcome.kind === "applied" || outcome.kind === "duplicate") {
      // Re-read the Org to surface the post-update status to the caller.
      const after = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { subscription_status: true },
      });
      return {
        kind: "applied",
        subscription_status: after?.subscription_status ?? "Unknown",
      };
    }
    return { kind: "no_subscription" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.warn("[onboarding.reconcile] stripe error", message);
    return { kind: "stripe_error", message };
  }
}
