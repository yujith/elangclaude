import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "@prisma/client";
import { prisma } from "./client";
import { resetDatabase } from "./test-helpers";
import {
  decimalToCents,
  syncPlanToStripe,
  type PlanSyncStripeClient,
  type PlanSyncProduct,
  type PlanSyncPrice,
} from "./plan-sync";

beforeEach(async () => {
  await resetDatabase();
});

// ─── Fake Stripe client ─────────────────────────────────────────────────
//
// In-memory store of Products + Prices. Mirrors only the slice of the
// SDK that PlanSyncStripeClient touches.

function buildFakeStripe() {
  const products = new Map<string, PlanSyncProduct & { name: string; metadata: Record<string, string> }>();
  const prices = new Map<string, PlanSyncPrice & { metadata: Record<string, string> }>();
  let productSeq = 0;
  let priceSeq = 0;

  const productsApi = {
    retrieve: vi.fn(async (id: string) => {
      const p = products.get(id);
      if (!p) throw new Error(`No such product: ${id}`);
      return p;
    }),
    update: vi.fn(async (id: string, params: { name?: string; metadata?: Record<string, string>; active?: boolean }) => {
      const p = products.get(id);
      if (!p) throw new Error(`No such product: ${id}`);
      Object.assign(p, params, { metadata: { ...p.metadata, ...(params.metadata ?? {}) } });
      return p;
    }),
    create: vi.fn(async (params: { name: string; active?: boolean; metadata?: Record<string, string> }) => {
      const id = `prod_test_${++productSeq}`;
      const p = {
        id,
        name: params.name,
        active: params.active ?? true,
        metadata: { ...(params.metadata ?? {}) },
        deleted: false,
      };
      products.set(id, p);
      return p;
    }),
    search: vi.fn(async (params: { query: string }) => {
      // Tests only ever query by plan_slug.
      const match = params.query.match(/plan_slug.\]:'([^']+)'/);
      if (!match) return { data: [] };
      const slug = match[1];
      const found = [...products.values()].filter(
        (p) => p.metadata.plan_slug === slug && !p.deleted,
      );
      return { data: found };
    }),
  };

  const pricesApi = {
    retrieve: vi.fn(async (id: string) => {
      const p = prices.get(id);
      if (!p) throw new Error(`No such price: ${id}`);
      return p;
    }),
    create: vi.fn(async (params: { product: string; unit_amount: number; currency: string; metadata?: Record<string, string> }) => {
      const id = `price_test_${++priceSeq}`;
      const price: PlanSyncPrice & { metadata: Record<string, string> } = {
        id,
        active: true,
        unit_amount: params.unit_amount,
        currency: params.currency,
        product: params.product,
        recurring: { interval: "month" },
        metadata: { ...(params.metadata ?? {}) },
      };
      prices.set(id, price);
      return price;
    }),
    update: vi.fn(async (id: string, params: { active?: boolean }) => {
      const p = prices.get(id);
      if (!p) throw new Error(`No such price: ${id}`);
      if (params.active !== undefined) p.active = params.active;
      return p;
    }),
    list: vi.fn(async (params: { product: string; active?: boolean }) => {
      const productId = params.product;
      const all = [...prices.values()].filter((p) => {
        const pid = typeof p.product === "string" ? p.product : p.product.id;
        if (pid !== productId) return false;
        if (params.active === true && !p.active) return false;
        if (params.active === false && p.active) return false;
        return true;
      });
      return { data: all };
    }),
  };

  const client: PlanSyncStripeClient = {
    products: productsApi,
    prices: pricesApi,
  };
  return { client, products, prices, productsApi, pricesApi };
}

async function seedPlan(
  overrides: Partial<Omit<Plan, "amount_monthly_usd">> & {
    slug: string;
    amount_monthly_usd?: string;
  },
): Promise<Plan> {
  return prisma.plan.create({
    data: {
      slug: overrides.slug,
      name: overrides.name ?? overrides.slug,
      description: overrides.description ?? null,
      seat_limit: overrides.seat_limit ?? 25,
      quota_daily: overrides.quota_daily ?? 50,
      quota_monthly: overrides.quota_monthly ?? 1000,
      amount_monthly_usd: overrides.amount_monthly_usd ?? "49.00",
      trial_days: overrides.trial_days ?? 14,
      is_internal: overrides.is_internal ?? false,
      is_active: overrides.is_active ?? true,
      sort_order: overrides.sort_order ?? 100,
      stripe_product_id: overrides.stripe_product_id ?? null,
      stripe_price_id_monthly: overrides.stripe_price_id_monthly ?? null,
    },
  });
}

describe("decimalToCents", () => {
  it.each([
    ["0", 0],
    ["49", 4900],
    ["49.00", 4900],
    ["49.5", 4950],
    ["49.50", 4950],
    ["199.99", 19999],
  ])("converts %s → %i", (input, expected) => {
    expect(decimalToCents(input as unknown as Plan["amount_monthly_usd"])).toBe(expected);
  });

  it("rejects negative and 3dp values", () => {
    expect(() => decimalToCents("-1" as unknown as Plan["amount_monthly_usd"])).toThrow();
    expect(() => decimalToCents("1.234" as unknown as Plan["amount_monthly_usd"])).toThrow();
  });
});

describe("syncPlanToStripe", () => {
  it("skips internal plans without hitting Stripe", async () => {
    const { client, productsApi } = buildFakeStripe();
    const plan = await seedPlan({
      slug: "internal",
      is_internal: true,
      amount_monthly_usd: "0.00",
    });

    const result = await syncPlanToStripe(client, plan);
    expect(result).toMatchObject({ ok: true, kind: "skipped_internal" });
    expect(productsApi.create).not.toHaveBeenCalled();
  });

  it("skips free (amount=0) plans without hitting Stripe", async () => {
    const { client, productsApi } = buildFakeStripe();
    const plan = await seedPlan({
      slug: "free",
      amount_monthly_usd: "0.00",
    });

    const result = await syncPlanToStripe(client, plan);
    expect(result).toMatchObject({ ok: true, kind: "skipped_free" });
    expect(productsApi.create).not.toHaveBeenCalled();
  });

  it("creates Product + Price on first sync, stamps ids on the Plan", async () => {
    const { client, productsApi, pricesApi } = buildFakeStripe();
    const plan = await seedPlan({ slug: "starter", amount_monthly_usd: "49.00" });

    const result = await syncPlanToStripe(client, plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("created");
    expect(result.stripe_product_id).toMatch(/^prod_test_/);
    expect(result.stripe_price_id_monthly).toMatch(/^price_test_/);

    expect(productsApi.create).toHaveBeenCalledTimes(1);
    expect(productsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "starter",
        metadata: { plan_slug: "starter", plan_id: plan.id },
      }),
    );
    expect(pricesApi.create).toHaveBeenCalledTimes(1);
    expect(pricesApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        unit_amount: 4900,
        currency: "usd",
        recurring: { interval: "month" },
      }),
    );

    const persisted = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(persisted.stripe_product_id).toBe(result.stripe_product_id);
    expect(persisted.stripe_price_id_monthly).toBe(result.stripe_price_id_monthly);
  });

  it("is a noop on the second sync when nothing changed", async () => {
    const { client, productsApi, pricesApi } = buildFakeStripe();
    let plan = await seedPlan({ slug: "pro", amount_monthly_usd: "199.00" });

    const first = await syncPlanToStripe(client, plan);
    expect(first.ok && first.kind).toBe("created");

    plan = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    productsApi.create.mockClear();
    pricesApi.create.mockClear();

    const second = await syncPlanToStripe(client, plan);
    expect(second).toMatchObject({ ok: true, kind: "noop" });
    expect(productsApi.create).not.toHaveBeenCalled();
    expect(pricesApi.create).not.toHaveBeenCalled();
  });

  it("when amount changes, deactivates old Price and creates a new one", async () => {
    const { client, pricesApi } = buildFakeStripe();
    let plan = await seedPlan({ slug: "starter", amount_monthly_usd: "49.00" });

    const first = await syncPlanToStripe(client, plan);
    expect(first.ok && first.kind).toBe("created");
    if (!first.ok) return;
    const oldPriceId = first.stripe_price_id_monthly!;

    // Bump price.
    plan = await prisma.plan.update({
      where: { id: plan.id },
      data: { amount_monthly_usd: "59.00" },
    });

    const second = await syncPlanToStripe(client, plan);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.kind).toBe("updated");
    expect(second.stripe_price_id_monthly).not.toBe(oldPriceId);

    expect(pricesApi.update).toHaveBeenCalledWith(oldPriceId, { active: false });
    expect(pricesApi.create).toHaveBeenCalledTimes(2);
  });

  it("recovers from a crash that created the Product but never stamped the id", async () => {
    const { client, productsApi } = buildFakeStripe();
    // Simulate: previous run created the Product, then crashed.
    const orphan = await productsApi.create({
      name: "Pro (orphaned)",
      metadata: { plan_slug: "pro", plan_id: "stale" },
    });
    const plan = await seedPlan({ slug: "pro", amount_monthly_usd: "199.00" });

    productsApi.create.mockClear();

    const result = await syncPlanToStripe(client, plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Same Product is re-used — search-by-metadata recovery worked.
    expect(result.stripe_product_id).toBe(orphan.id);
    expect(productsApi.create).not.toHaveBeenCalled();
  });

  it("returns stripe_error when the SDK throws", async () => {
    const { client, productsApi } = buildFakeStripe();
    productsApi.create.mockRejectedValueOnce(new Error("Stripe is down"));
    const plan = await seedPlan({ slug: "starter", amount_monthly_usd: "49.00" });

    const result = await syncPlanToStripe(client, plan);
    expect(result).toEqual({
      ok: false,
      reason: "stripe_error",
      message: "Stripe is down",
    });
  });

  it("when is_active=false, deactivates the Stripe Product + Price", async () => {
    const { client, products, prices, productsApi, pricesApi } = buildFakeStripe();
    let plan = await seedPlan({ slug: "to-archive", amount_monthly_usd: "29.00" });

    // First sync creates active Product + Price.
    const first = await syncPlanToStripe(client, plan);
    expect(first.ok && first.kind).toBe("created");
    if (!first.ok) return;
    const productId = first.stripe_product_id!;
    const priceId = first.stripe_price_id_monthly!;

    productsApi.update.mockClear();
    pricesApi.update.mockClear();

    // Flip to archived in our DB, then sync.
    plan = await prisma.plan.update({
      where: { id: plan.id },
      data: { is_active: false },
    });
    const second = await syncPlanToStripe(client, plan);
    expect(second).toMatchObject({
      ok: true,
      kind: "archived",
      stripe_product_id: productId,
      stripe_price_id_monthly: priceId,
    });

    // Stripe state reflects the archive.
    expect(productsApi.update).toHaveBeenCalledWith(
      productId,
      expect.objectContaining({ active: false }),
    );
    expect(pricesApi.update).toHaveBeenCalledWith(priceId, { active: false });
    expect(products.get(productId)?.active).toBe(false);
    expect(prices.get(priceId)?.active).toBe(false);
  });

  it("when archiving and the Stripe Product was hard-deleted, clears the dangling id", async () => {
    const { client } = buildFakeStripe();
    // Plan has a stamped product id that doesn't exist in Stripe at all
    // (simulates: SuperAdmin deleted in Stripe dashboard).
    const plan = await seedPlan({
      slug: "stripe-deleted",
      amount_monthly_usd: "29.00",
      is_active: false,
      stripe_product_id: "prod_test_missing",
      stripe_price_id_monthly: "price_test_missing",
    });

    const result = await syncPlanToStripe(client, plan);
    expect(result).toMatchObject({
      ok: true,
      kind: "archived",
      stripe_product_id: null,
      stripe_price_id_monthly: null,
    });

    const persisted = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(persisted.stripe_product_id).toBeNull();
    expect(persisted.stripe_price_id_monthly).toBeNull();
  });

  it("unarchives by re-activating the Stripe Product when is_active flips back to true", async () => {
    const { client, products, productsApi } = buildFakeStripe();
    let plan = await seedPlan({
      slug: "unarchive",
      amount_monthly_usd: "29.00",
    });

    // Sync, archive, then re-activate.
    await syncPlanToStripe(client, plan);
    plan = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    const productId = plan.stripe_product_id!;
    plan = await prisma.plan.update({
      where: { id: plan.id },
      data: { is_active: false },
    });
    await syncPlanToStripe(client, plan);
    expect(products.get(productId)?.active).toBe(false);

    plan = await prisma.plan.update({
      where: { id: plan.id },
      data: { is_active: true },
    });
    productsApi.update.mockClear();

    const third = await syncPlanToStripe(client, plan);
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    // Kind is "noop" or "updated" depending on whether any id changed.
    // The important thing is the Stripe state and id reuse — no
    // duplicate Product/Price on unarchive.
    expect(third.stripe_product_id).toBe(productId);
    expect(productsApi.update).toHaveBeenCalledWith(
      productId,
      expect.objectContaining({ active: true }),
    );
    expect(products.get(productId)?.active).toBe(true);
  });
});
