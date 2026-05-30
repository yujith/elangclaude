import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { resetDatabase } from "./test-helpers";
import { SYSTEM_ORG_ID, SYSTEM_ORG_NAME } from "./system-org";
import {
  applyCheckoutSessionCompleted,
  applyCustomerSubscriptionDeleted,
  applyCustomerSubscriptionUpserted,
  applyInvoicePaymentFailed,
  applyTrialWillEnd,
  dispatchStripeEvent,
  mapSubscriptionStatus,
  type StripeCheckoutSessionEvent,
  type StripeEventEnvelope,
  type StripeInvoiceEvent,
  type StripeSubscriptionEvent,
} from "./stripe-events";

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

beforeEach(async () => {
  await resetDatabase();
  await ensureSystemOrg();
});

async function seedPlan(
  slug: string,
  options: {
    stripe_product_id?: string;
    stripe_price_id_monthly?: string;
    seat_limit?: number;
    quota_daily?: number;
    quota_monthly?: number;
  } = {},
) {
  return prisma.plan.create({
    data: {
      slug,
      name: slug,
      seat_limit: options.seat_limit ?? 25,
      quota_daily: options.quota_daily ?? 50,
      quota_monthly: options.quota_monthly ?? 1000,
      amount_monthly_usd: "49.00",
      trial_days: 14,
      sort_order: 100,
      stripe_product_id: options.stripe_product_id ?? null,
      stripe_price_id_monthly: options.stripe_price_id_monthly ?? null,
    },
  });
}

async function seedOrg(
  overrides: {
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    plan_id?: string | null;
    subscription_status?:
      | "PendingPayment"
      | "Trialing"
      | "Active"
      | "PastDue"
      | "Canceled"
      | "Incomplete"
      | "Internal";
    status?: "Active" | "Suspended" | "Archived";
  } = {},
) {
  return prisma.organization.create({
    data: {
      name: "Test Org",
      seat_limit: 10,
      quota_daily: 50,
      quota_monthly: 1000,
      status: overrides.status ?? "Active",
      subscription_status: overrides.subscription_status ?? "PendingPayment",
      stripe_customer_id: overrides.stripe_customer_id ?? "cus_test_default",
      stripe_subscription_id: overrides.stripe_subscription_id ?? null,
      plan_id: overrides.plan_id ?? null,
    },
  });
}

function subscriptionEvent(
  overrides: Partial<StripeSubscriptionEvent> & { customer: string },
): StripeSubscriptionEvent {
  return {
    id: overrides.id ?? "sub_test_default",
    customer: overrides.customer,
    status: overrides.status ?? "trialing",
    current_period_end: overrides.current_period_end ?? 1900000000,
    trial_end: overrides.trial_end ?? null,
    items: overrides.items,
    metadata: overrides.metadata,
  };
}

function envelope(
  type: string,
  data: unknown,
  options: { id?: string; created?: number } = {},
): StripeEventEnvelope {
  return {
    id: options.id ?? `evt_test_${Math.random().toString(36).slice(2, 10)}`,
    type,
    created: options.created ?? Math.floor(Date.now() / 1000),
    data: { object: data },
  };
}

describe("mapSubscriptionStatus", () => {
  it.each([
    ["trialing", "Trialing"],
    ["active", "Active"],
    ["past_due", "PastDue"],
    ["unpaid", "PastDue"],
    ["canceled", "Canceled"],
    ["incomplete_expired", "Canceled"],
    ["incomplete", "Incomplete"],
  ])("maps %s → %s", (input, expected) => {
    expect(mapSubscriptionStatus(input as never)).toBe(expected);
  });
});

describe("recordStripeEvent idempotency", () => {
  it("a duplicate delivery of the same event is a no-op", async () => {
    const org = await seedOrg({ stripe_customer_id: "cus_idem" });
    const env = envelope(
      "customer.subscription.updated",
      subscriptionEvent({ customer: "cus_idem", status: "active" }),
      { id: "evt_replay" },
    );

    const first = await applyCustomerSubscriptionUpserted(
      env,
      env.data.object as StripeSubscriptionEvent,
    );
    expect(first.kind).toBe("applied");

    const second = await applyCustomerSubscriptionUpserted(
      env,
      env.data.object as StripeSubscriptionEvent,
    );
    expect(second.kind).toBe("duplicate");

    const logs = await prisma.stripeEventLog.findMany({
      where: { stripe_event_id: "evt_replay" },
    });
    expect(logs).toHaveLength(1);
    const refreshed = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(refreshed.subscription_status).toBe("Active");
  });
});

describe("applyCheckoutSessionCompleted", () => {
  it("stamps stripe_subscription_id on the matching Org", async () => {
    const org = await seedOrg({ stripe_customer_id: "cus_checkout" });
    const env = envelope("checkout.session.completed", {
      id: "cs_test",
      mode: "subscription",
      customer: "cus_checkout",
      subscription: "sub_test_new",
      metadata: { org_id: org.id },
    } satisfies StripeCheckoutSessionEvent);

    const result = await applyCheckoutSessionCompleted(
      env,
      env.data.object as StripeCheckoutSessionEvent,
    );
    expect(result).toMatchObject({ kind: "applied", org_id: org.id });

    const refreshed = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(refreshed.stripe_subscription_id).toBe("sub_test_new");

    const logs = await prisma.activityLog.findMany({
      where: { org_id: SYSTEM_ORG_ID, action: "super.subscription.checkout_completed" },
    });
    expect(logs).toHaveLength(1);
  });

  it("ignores sessions with no Org match", async () => {
    const env = envelope("checkout.session.completed", {
      id: "cs_test",
      mode: "subscription",
      customer: "cus_unknown",
      subscription: "sub_test",
      metadata: null,
    } satisfies StripeCheckoutSessionEvent);

    const result = await applyCheckoutSessionCompleted(
      env,
      env.data.object as StripeCheckoutSessionEvent,
    );
    expect(result.kind).toBe("ignored");
  });

  it("ignores when metadata.org_id mismatches the resolved Org", async () => {
    const org = await seedOrg({ stripe_customer_id: "cus_mismatch" });
    const env = envelope("checkout.session.completed", {
      id: "cs_test",
      mode: "subscription",
      customer: "cus_mismatch",
      subscription: "sub_test",
      metadata: { org_id: "some-other-org" },
    } satisfies StripeCheckoutSessionEvent);

    const result = await applyCheckoutSessionCompleted(
      env,
      env.data.object as StripeCheckoutSessionEvent,
    );
    expect(result).toMatchObject({ kind: "ignored", reason: "metadata_org_id_mismatch" });

    const refreshed = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(refreshed.stripe_subscription_id).toBeNull();
  });
});

describe("applyCustomerSubscriptionUpserted", () => {
  it("activates a PendingPayment Org into Trialing and copies plan limits", async () => {
    const plan = await seedPlan("pro", {
      stripe_price_id_monthly: "price_pro_monthly",
      seat_limit: 100,
      quota_daily: 100,
      quota_monthly: 3000,
    });
    const org = await seedOrg({
      stripe_customer_id: "cus_activate",
      subscription_status: "PendingPayment",
      status: "Active",
      plan_id: plan.id,
    });

    const env = envelope(
      "customer.subscription.created",
      subscriptionEvent({
        id: "sub_pro",
        customer: "cus_activate",
        status: "trialing",
        trial_end: 1900000000,
        items: { data: [{ price: { id: "price_pro_monthly" } }] },
        metadata: { org_id: org.id },
      }),
    );

    const result = await applyCustomerSubscriptionUpserted(
      env,
      env.data.object as StripeSubscriptionEvent,
    );
    expect(result).toMatchObject({
      kind: "applied",
      org_id: org.id,
      subscription_status: "Trialing",
    });

    const refreshed = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(refreshed.subscription_status).toBe("Trialing");
    expect(refreshed.seat_limit).toBe(100);
    expect(refreshed.quota_daily).toBe(100);
    expect(refreshed.quota_monthly).toBe(3000);
    expect(refreshed.stripe_subscription_id).toBe("sub_pro");
    expect(refreshed.trial_end).not.toBeNull();
  });

  it("does NOT downgrade when an older PastDue event arrives after a newer Active event", async () => {
    const org = await seedOrg({ stripe_customer_id: "cus_order" });

    const activatedAt = 2_000_000_000;
    const olderAt = 1_999_999_900;

    const activeEnv = envelope(
      "customer.subscription.updated",
      subscriptionEvent({
        id: "sub_order",
        customer: "cus_order",
        status: "active",
      }),
      { id: "evt_active", created: activatedAt },
    );
    const oldEnv = envelope(
      "customer.subscription.updated",
      subscriptionEvent({
        id: "sub_order",
        customer: "cus_order",
        status: "past_due",
      }),
      { id: "evt_old_past_due", created: olderAt },
    );

    const firstResult = await applyCustomerSubscriptionUpserted(
      activeEnv,
      activeEnv.data.object as StripeSubscriptionEvent,
    );
    expect(firstResult.kind).toBe("applied");

    const secondResult = await applyCustomerSubscriptionUpserted(
      oldEnv,
      oldEnv.data.object as StripeSubscriptionEvent,
    );
    expect(secondResult).toMatchObject({
      kind: "ignored",
      reason: "stale_downgrade_ignored",
    });

    const refreshed = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(refreshed.subscription_status).toBe("Active");
  });
});

describe("applyCustomerSubscriptionDeleted", () => {
  it("flips Org status to Suspended and subscription_status to Canceled", async () => {
    const org = await seedOrg({
      stripe_customer_id: "cus_canceled",
      subscription_status: "Active",
      status: "Active",
    });
    const env = envelope(
      "customer.subscription.deleted",
      subscriptionEvent({
        id: "sub_canceled",
        customer: "cus_canceled",
        status: "canceled",
      }),
    );

    const result = await applyCustomerSubscriptionDeleted(
      env,
      env.data.object as StripeSubscriptionEvent,
    );
    expect(result.kind).toBe("applied");

    const refreshed = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(refreshed.subscription_status).toBe("Canceled");
    expect(refreshed.status).toBe("Suspended");

    const superLogs = await prisma.activityLog.findMany({
      where: { org_id: SYSTEM_ORG_ID, action: "super.subscription.canceled" },
    });
    const orgLogs = await prisma.activityLog.findMany({
      where: { org_id: org.id, action: "subscription.canceled" },
    });
    expect(superLogs).toHaveLength(1);
    expect(orgLogs).toHaveLength(1);
  });
});

describe("applyInvoicePaymentFailed", () => {
  it("flips subscription_status to PastDue but leaves OrgStatus Active", async () => {
    const org = await seedOrg({
      stripe_customer_id: "cus_past_due",
      subscription_status: "Active",
      status: "Active",
    });
    const env = envelope("invoice.payment_failed", {
      id: "in_past_due",
      customer: "cus_past_due",
      subscription: "sub_past_due",
    } satisfies StripeInvoiceEvent);

    const result = await applyInvoicePaymentFailed(
      env,
      env.data.object as StripeInvoiceEvent,
    );
    expect(result.kind).toBe("applied");

    const refreshed = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(refreshed.subscription_status).toBe("PastDue");
    expect(refreshed.status).toBe("Active");
  });
});

describe("applyTrialWillEnd", () => {
  it("only writes an activity log; does not change subscription_status", async () => {
    const org = await seedOrg({
      stripe_customer_id: "cus_trial",
      subscription_status: "Trialing",
      status: "Active",
    });
    const env = envelope(
      "customer.subscription.trial_will_end",
      subscriptionEvent({
        id: "sub_trial",
        customer: "cus_trial",
        status: "trialing",
        trial_end: 1900000000,
      }),
    );

    const result = await applyTrialWillEnd(
      env,
      env.data.object as StripeSubscriptionEvent,
    );
    expect(result.kind).toBe("applied");

    const refreshed = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(refreshed.subscription_status).toBe("Trialing");

    const orgLogs = await prisma.activityLog.findMany({
      where: { org_id: org.id, action: "subscription.trial_will_end" },
    });
    expect(orgLogs).toHaveLength(1);
  });
});

describe("dispatchStripeEvent", () => {
  it("records unknown event types and ignores them", async () => {
    const env = envelope("payment_intent.succeeded", { id: "pi_test" });
    const result = await dispatchStripeEvent(env);
    expect(result).toMatchObject({
      kind: "ignored",
      reason: "unhandled_event_type",
    });
    const logs = await prisma.stripeEventLog.findMany({
      where: { stripe_event_id: env.id },
    });
    expect(logs).toHaveLength(1);
  });
});
