// Pure handlers for Stripe webhook events (ADR-0017 Phase 4).
//
// Lives in @elc/db so the existing Postgres test infrastructure can drive
// it. The route handler in apps/web/app/api/stripe/webhook/route.ts is a
// thin wrapper that verifies the Stripe signature, parses the event, and
// dispatches into here.
//
// Idempotency: every dispatch starts with `recordStripeEvent`, which
// inserts into StripeEventLog (unique on stripe_event_id). A duplicate
// insert (Stripe redelivered the same event) returns "duplicate" and the
// caller no-ops with a 200.
//
// Monotonic ordering: for state downgrades (e.g. Active → PastDue), we
// compare the incoming event.created against the most recent processed
// event for the same Org. Out-of-order events are dropped — see ADR-0017
// D8 and the [webhook-ordering-followup] memory.
//
// Multi-tenancy belt-and-braces (ADR-0017 D7): every Stripe Customer and
// Subscription stamps `metadata.org_id` (set in Phase 5). When present,
// we compare it against the Org row we resolved by stripe_customer_id;
// a mismatch is logged + ignored so a misconfigured Stripe webhook can
// never mutate the wrong Org.

import { Prisma, type Organization } from "@prisma/client";
import { prisma } from "./client";
import { SYSTEM_ORG_ID } from "./system-org";

// ─── Narrow event payload types ─────────────────────────────────────────
//
// We only need a small slice of the Stripe object shapes. Defining them
// locally keeps the Stripe SDK out of @elc/db (mirrors the plan-sync
// pattern) and gives us a single place to look up "what fields we read".

export type SubscriptionItem = { price: { id: string } };

export type StripeSubscriptionEvent = {
  id: string;
  customer: string;
  status:
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "incomplete"
    | "incomplete_expired"
    | "unpaid"
    | "paused";
  current_period_end?: number | null;
  trial_end?: number | null;
  cancel_at?: number | null;
  canceled_at?: number | null;
  items?: { data: SubscriptionItem[] };
  metadata?: Record<string, string> | null;
};

export type StripeCheckoutSessionEvent = {
  id: string;
  mode: string;
  customer: string | null;
  subscription: string | null;
  metadata?: Record<string, string> | null;
};

export type StripeInvoiceEvent = {
  id: string;
  customer: string | null;
  subscription: string | null;
};

export type StripeEventEnvelope = {
  id: string;
  type: string;
  created: number; // unix seconds
  data: { object: unknown };
};

// ─── Public result types ────────────────────────────────────────────────

export type StripeEventOutcome =
  | { kind: "duplicate"; event_id: string }
  | { kind: "ignored"; event_id: string; reason: string }
  | {
      kind: "applied";
      event_id: string;
      org_id: string;
      subscription_status?: string;
    };

// ─── Idempotency primitive ──────────────────────────────────────────────

// Returns true if we should proceed (first sighting), false if Stripe
// redelivered an event we already handled. The actual Org-side work is
// only performed when this returns true, so a P2002 race between two
// concurrent webhook deliveries naturally collapses into one apply.
export async function recordStripeEvent(
  envelope: StripeEventEnvelope,
  orgId: string | null,
  payloadSummary: Prisma.InputJsonValue | null,
): Promise<boolean> {
  try {
    await prisma.stripeEventLog.create({
      data: {
        stripe_event_id: envelope.id,
        event_type: envelope.type,
        event_created_at: new Date(envelope.created * 1000),
        org_id: orgId,
        payload_summary: payloadSummary ?? undefined,
      },
    });
    return true;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return false;
    }
    throw err;
  }
}

// ─── Org lookup + metadata cross-check ──────────────────────────────────

type ResolvedOrg = Pick<
  Organization,
  | "id"
  | "plan_id"
  | "stripe_customer_id"
  | "stripe_subscription_id"
  | "subscription_status"
  | "status"
  | "seat_limit"
  | "quota_daily"
  | "quota_monthly"
>;

async function resolveOrgByCustomer(
  customerId: string,
): Promise<ResolvedOrg | null> {
  return prisma.organization.findUnique({
    where: { stripe_customer_id: customerId },
    select: {
      id: true,
      plan_id: true,
      stripe_customer_id: true,
      stripe_subscription_id: true,
      subscription_status: true,
      status: true,
      seat_limit: true,
      quota_daily: true,
      quota_monthly: true,
    },
  });
}

// ADR-0017 D7: when Stripe stamps `metadata.org_id` on the object (set
// in Phase 5 at Customer + Subscription create), check it matches the
// Org we resolved by stripe_customer_id. Returns true if everything is
// consistent (or if no metadata.org_id was set), false on mismatch.
function metadataMatches(
  metadata: Record<string, string> | null | undefined,
  org_id: string,
): boolean {
  const claimed = metadata?.org_id;
  if (!claimed) return true;
  return claimed === org_id;
}

// ─── Monotonic-ordering guard ───────────────────────────────────────────

// Pulled in for downgrade transitions only (Active → PastDue, etc.).
// An incoming event that's older than the last subscription-lifecycle
// event we processed for this Org is dropped — Stripe's redelivery
// queue can deliver out of order, and a stale "past_due" must not
// silently overwrite a newer "active".
async function isStaleForDowngrade(
  envelope: StripeEventEnvelope,
  org_id: string,
): Promise<boolean> {
  const latest = await prisma.stripeEventLog.findFirst({
    where: {
      org_id,
      event_type: {
        in: [
          "checkout.session.completed",
          "customer.subscription.created",
          "customer.subscription.updated",
          "customer.subscription.deleted",
        ],
      },
      // Exclude the row we just inserted for this event.
      NOT: { stripe_event_id: envelope.id },
    },
    orderBy: { event_created_at: "desc" },
    select: { event_created_at: true },
  });
  if (!latest) return false;
  return new Date(envelope.created * 1000) < latest.event_created_at;
}

// ─── Event handlers ─────────────────────────────────────────────────────

export async function applyCheckoutSessionCompleted(
  envelope: StripeEventEnvelope,
  session: StripeCheckoutSessionEvent,
): Promise<StripeEventOutcome> {
  if (session.mode !== "subscription") {
    return ignored(envelope, "not_a_subscription_session");
  }
  if (!session.customer) {
    return ignored(envelope, "no_customer_on_session");
  }

  const org = await resolveOrgByCustomer(session.customer);
  if (!org) {
    // Customer exists in Stripe but no Org rows it. Could be a race
    // (Phase 5 Checkout Session creation hasn't stamped yet) or
    // misconfigured webhook target. Log and ignore — the next
    // subscription.* event will retry.
    await recordStripeEvent(envelope, null, {
      reason: "org_not_found_for_customer",
      stripe_customer_id: session.customer,
    } satisfies Prisma.InputJsonValue);
    return ignored(envelope, "org_not_found_for_customer");
  }
  if (!metadataMatches(session.metadata, org.id)) {
    await recordStripeEvent(envelope, org.id, {
      reason: "metadata_org_id_mismatch",
      claimed_org_id: session.metadata?.org_id,
      lookup_org_id: org.id,
    } satisfies Prisma.InputJsonValue);
    return ignored(envelope, "metadata_org_id_mismatch");
  }

  const firstSighting = await recordStripeEvent(envelope, org.id, {
    subscription: session.subscription,
  } satisfies Prisma.InputJsonValue);
  if (!firstSighting) return { kind: "duplicate", event_id: envelope.id };

  if (session.subscription && org.stripe_subscription_id !== session.subscription) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { stripe_subscription_id: session.subscription },
    });
  }

  await prisma.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      action: "super.subscription.checkout_completed",
      metadata: {
        org_id: org.id,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
      } as Prisma.InputJsonValue,
    },
  });

  return { kind: "applied", event_id: envelope.id, org_id: org.id };
}

export async function applyCustomerSubscriptionUpserted(
  envelope: StripeEventEnvelope,
  subscription: StripeSubscriptionEvent,
): Promise<StripeEventOutcome> {
  if (!subscription.customer) {
    return ignored(envelope, "no_customer_on_subscription");
  }

  const org = await resolveOrgByCustomer(subscription.customer);
  if (!org) {
    await recordStripeEvent(envelope, null, {
      reason: "org_not_found_for_customer",
      stripe_customer_id: subscription.customer,
      stripe_subscription_id: subscription.id,
    } satisfies Prisma.InputJsonValue);
    return ignored(envelope, "org_not_found_for_customer");
  }
  if (!metadataMatches(subscription.metadata, org.id)) {
    await recordStripeEvent(envelope, org.id, {
      reason: "metadata_org_id_mismatch",
      claimed_org_id: subscription.metadata?.org_id,
      lookup_org_id: org.id,
    } satisfies Prisma.InputJsonValue);
    return ignored(envelope, "metadata_org_id_mismatch");
  }

  const firstSighting = await recordStripeEvent(envelope, org.id, {
    stripe_subscription_id: subscription.id,
    status: subscription.status,
  } satisfies Prisma.InputJsonValue);
  if (!firstSighting) return { kind: "duplicate", event_id: envelope.id };

  const newStatus = mapSubscriptionStatus(subscription.status);
  const oldStatus = org.subscription_status;
  const isDowngrade = newStatus !== "Active" && newStatus !== "Trialing" && newStatus !== "Internal";

  if (isDowngrade) {
    const stale = await isStaleForDowngrade(envelope, org.id);
    if (stale) return ignored(envelope, "stale_downgrade_ignored");
  }

  // Resolve which Plan this subscription is on by matching price id.
  // Falls back to whatever plan_id the Org row currently carries.
  const priceId = subscription.items?.data?.[0]?.price?.id ?? null;
  let planSnapshot: { id: string; seat_limit: number; quota_daily: number; quota_monthly: number } | null = null;
  if (priceId) {
    const plan = await prisma.plan.findFirst({
      where: { stripe_price_id_monthly: priceId },
      select: {
        id: true,
        seat_limit: true,
        quota_daily: true,
        quota_monthly: true,
      },
    });
    if (plan) planSnapshot = plan;
  }

  const data: Prisma.OrganizationUpdateInput = {
    stripe_subscription_id: subscription.id,
    subscription_status: newStatus,
    current_period_end: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null,
    trial_end: subscription.trial_end
      ? new Date(subscription.trial_end * 1000)
      : null,
  };

  if (planSnapshot) {
    data.plan = { connect: { id: planSnapshot.id } };
    data.seat_limit = planSnapshot.seat_limit;
    data.quota_daily = planSnapshot.quota_daily;
    data.quota_monthly = planSnapshot.quota_monthly;
  }

  // First transition into a live state flips the Org out of Suspended
  // / whatever-other moderation state into Active. We never downgrade
  // OrgStatus here — that's a SuperAdmin-driven moderation decision —
  // except via the deletion path (handled in applyCustomerSubscriptionDeleted).
  const becomingLive =
    (newStatus === "Trialing" || newStatus === "Active") &&
    org.subscription_status !== "Active" &&
    org.subscription_status !== "Trialing";
  if (becomingLive && org.status !== "Active") {
    data.status = "Active";
  }

  await prisma.organization.update({
    where: { id: org.id },
    data,
  });

  // ActivityLog dual-write: super.* under system org for cross-org
  // SuperAdmin views; subscription.* under the customer org so
  // OrgAdmin's own activity feed shows the billing event.
  await prisma.$transaction([
    prisma.activityLog.create({
      data: {
        org_id: SYSTEM_ORG_ID,
        action: `super.subscription.${newStatus.toLowerCase()}`,
        metadata: {
          org_id: org.id,
          stripe_subscription_id: subscription.id,
          from_status: oldStatus,
          to_status: newStatus,
        } as Prisma.InputJsonValue,
      },
    }),
    prisma.activityLog.create({
      data: {
        org_id: org.id,
        action: becomingLive
          ? "subscription.activated"
          : `subscription.${newStatus.toLowerCase()}`,
        metadata: {
          stripe_subscription_id: subscription.id,
          from_status: oldStatus,
          to_status: newStatus,
        } as Prisma.InputJsonValue,
      },
    }),
  ]);

  return {
    kind: "applied",
    event_id: envelope.id,
    org_id: org.id,
    subscription_status: newStatus,
  };
}

export async function applyCustomerSubscriptionDeleted(
  envelope: StripeEventEnvelope,
  subscription: StripeSubscriptionEvent,
): Promise<StripeEventOutcome> {
  if (!subscription.customer) {
    return ignored(envelope, "no_customer_on_subscription");
  }

  const org = await resolveOrgByCustomer(subscription.customer);
  if (!org) {
    await recordStripeEvent(envelope, null, {
      reason: "org_not_found_for_customer",
      stripe_customer_id: subscription.customer,
    } satisfies Prisma.InputJsonValue);
    return ignored(envelope, "org_not_found_for_customer");
  }
  if (!metadataMatches(subscription.metadata, org.id)) {
    await recordStripeEvent(envelope, org.id, {
      reason: "metadata_org_id_mismatch",
    } satisfies Prisma.InputJsonValue);
    return ignored(envelope, "metadata_org_id_mismatch");
  }

  const firstSighting = await recordStripeEvent(envelope, org.id, {
    stripe_subscription_id: subscription.id,
  } satisfies Prisma.InputJsonValue);
  if (!firstSighting) return { kind: "duplicate", event_id: envelope.id };

  const stale = await isStaleForDowngrade(envelope, org.id);
  if (stale) return ignored(envelope, "stale_downgrade_ignored");

  await prisma.organization.update({
    where: { id: org.id },
    data: {
      subscription_status: "Canceled",
      // OrgStatus → Suspended flips the existing Suspended-org gate;
      // OrgSuspendedError in apps/web/lib/auth/context.ts routes the
      // OrgAdmin to /suspended automatically.
      status: "Suspended",
      current_period_end: null,
      trial_end: null,
    },
  });

  await prisma.$transaction([
    prisma.activityLog.create({
      data: {
        org_id: SYSTEM_ORG_ID,
        action: "super.subscription.canceled",
        metadata: {
          org_id: org.id,
          stripe_subscription_id: subscription.id,
          from_status: org.subscription_status,
        } as Prisma.InputJsonValue,
      },
    }),
    prisma.activityLog.create({
      data: {
        org_id: org.id,
        action: "subscription.canceled",
        metadata: {
          stripe_subscription_id: subscription.id,
        } as Prisma.InputJsonValue,
      },
    }),
  ]);

  return {
    kind: "applied",
    event_id: envelope.id,
    org_id: org.id,
    subscription_status: "Canceled",
  };
}

export async function applyInvoicePaymentFailed(
  envelope: StripeEventEnvelope,
  invoice: StripeInvoiceEvent,
): Promise<StripeEventOutcome> {
  if (!invoice.customer) return ignored(envelope, "no_customer_on_invoice");

  const org = await resolveOrgByCustomer(invoice.customer);
  if (!org) {
    await recordStripeEvent(envelope, null, {
      reason: "org_not_found_for_customer",
    } satisfies Prisma.InputJsonValue);
    return ignored(envelope, "org_not_found_for_customer");
  }

  const firstSighting = await recordStripeEvent(envelope, org.id, {
    stripe_subscription_id: invoice.subscription,
  } satisfies Prisma.InputJsonValue);
  if (!firstSighting) return { kind: "duplicate", event_id: envelope.id };

  const stale = await isStaleForDowngrade(envelope, org.id);
  if (stale) return ignored(envelope, "stale_downgrade_ignored");

  // PastDue is a soft-fail state — leave OrgStatus untouched until
  // Stripe Smart Retries bottom out and we receive
  // customer.subscription.deleted. The /admin/billing surface
  // (Phase 7) shows the past-due banner.
  if (org.subscription_status !== "PastDue") {
    await prisma.organization.update({
      where: { id: org.id },
      data: { subscription_status: "PastDue" },
    });
  }

  await prisma.$transaction([
    prisma.activityLog.create({
      data: {
        org_id: SYSTEM_ORG_ID,
        action: "super.subscription.past_due",
        metadata: {
          org_id: org.id,
          stripe_subscription_id: invoice.subscription,
        } as Prisma.InputJsonValue,
      },
    }),
    prisma.activityLog.create({
      data: {
        org_id: org.id,
        action: "subscription.past_due",
        metadata: {
          stripe_subscription_id: invoice.subscription,
        } as Prisma.InputJsonValue,
      },
    }),
  ]);

  return {
    kind: "applied",
    event_id: envelope.id,
    org_id: org.id,
    subscription_status: "PastDue",
  };
}

export async function applyTrialWillEnd(
  envelope: StripeEventEnvelope,
  subscription: StripeSubscriptionEvent,
): Promise<StripeEventOutcome> {
  if (!subscription.customer) {
    return ignored(envelope, "no_customer_on_subscription");
  }
  const org = await resolveOrgByCustomer(subscription.customer);
  if (!org) {
    await recordStripeEvent(envelope, null, {
      reason: "org_not_found_for_customer",
    } satisfies Prisma.InputJsonValue);
    return ignored(envelope, "org_not_found_for_customer");
  }

  const firstSighting = await recordStripeEvent(envelope, org.id, {
    stripe_subscription_id: subscription.id,
    trial_end: subscription.trial_end ?? null,
  } satisfies Prisma.InputJsonValue);
  if (!firstSighting) return { kind: "duplicate", event_id: envelope.id };

  // No state change — just an activity log row so /admin/billing can
  // render a "trial ending in N days" banner. Stripe sends its own
  // trial-ending email; we don't duplicate that.
  await prisma.activityLog.create({
    data: {
      org_id: org.id,
      action: "subscription.trial_will_end",
      metadata: {
        stripe_subscription_id: subscription.id,
        trial_end: subscription.trial_end ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  return { kind: "applied", event_id: envelope.id, org_id: org.id };
}

// ─── Top-level dispatch ─────────────────────────────────────────────────

export async function dispatchStripeEvent(
  envelope: StripeEventEnvelope,
): Promise<StripeEventOutcome> {
  switch (envelope.type) {
    case "checkout.session.completed":
      return applyCheckoutSessionCompleted(
        envelope,
        envelope.data.object as StripeCheckoutSessionEvent,
      );
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return applyCustomerSubscriptionUpserted(
        envelope,
        envelope.data.object as StripeSubscriptionEvent,
      );
    case "customer.subscription.deleted":
      return applyCustomerSubscriptionDeleted(
        envelope,
        envelope.data.object as StripeSubscriptionEvent,
      );
    case "customer.subscription.trial_will_end":
      return applyTrialWillEnd(
        envelope,
        envelope.data.object as StripeSubscriptionEvent,
      );
    case "invoice.payment_failed":
      return applyInvoicePaymentFailed(
        envelope,
        envelope.data.object as StripeInvoiceEvent,
      );
    default:
      // Unhandled event type — record it so we can see what's coming
      // through, but don't fail the webhook (Stripe will retry on 5xx
      // and that's wasted bandwidth for events we don't care about).
      await recordStripeEvent(envelope, null, {
        reason: "unhandled_event_type",
      } satisfies Prisma.InputJsonValue);
      return ignored(envelope, "unhandled_event_type");
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function ignored(
  envelope: StripeEventEnvelope,
  reason: string,
): StripeEventOutcome {
  return { kind: "ignored", event_id: envelope.id, reason };
}

export function mapSubscriptionStatus(
  raw: StripeSubscriptionEvent["status"],
):
  | "Trialing"
  | "Active"
  | "PastDue"
  | "Canceled"
  | "Incomplete"
  | "Internal" {
  switch (raw) {
    case "trialing":
      return "Trialing";
    case "active":
      return "Active";
    case "past_due":
    case "unpaid":
    case "paused":
      return "PastDue";
    case "canceled":
    case "incomplete_expired":
      return "Canceled";
    case "incomplete":
      return "Incomplete";
    default:
      return "Incomplete";
  }
}
