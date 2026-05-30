// Pure orchestration for pushing a Plan row to Stripe (ADR-0017 Phase 2).
//
// Lives in @elc/db so it sits next to the Prisma plan row it updates,
// and so the existing test branch infrastructure can drive it. We do
// NOT import the Stripe SDK here — the caller injects a narrow
// PlanSyncStripeClient interface, which keeps the package boundary
// clean and makes vitest stubbing trivial.
//
// apps/web/lib/billing/plan-sync.ts is the thin Stripe-aware wrapper
// that builds a real `Stripe` client and forwards into here.
//
// Idempotency contract:
//   - Looking up an existing Product by id is the fast path.
//   - If no id is stamped, search by metadata.plan_slug — a previous
//     sync may have created the Product but crashed before the DB
//     update.
//   - Stripe Prices are immutable on amount/interval. When the amount
//     changes, deactivate the old Price and create a new one.

import { prisma } from "./client";
import type { Plan } from "@prisma/client";
import { INTERNAL_PLAN_SLUG } from "./plans";

// ─── Narrow Stripe surface for testability ──────────────────────────────

export type PlanSyncProduct = {
  id: string;
  active?: boolean;
  deleted?: boolean;
};

export type PlanSyncPriceRecurring = { interval: "day" | "week" | "month" | "year" };

export type PlanSyncPrice = {
  id: string;
  active: boolean;
  unit_amount: number | null;
  currency: string;
  product: string | { id: string };
  recurring: PlanSyncPriceRecurring | null;
};

export type PlanSyncProductsAPI = {
  retrieve(id: string): Promise<PlanSyncProduct>;
  update(id: string, params: ProductUpdateParams): Promise<PlanSyncProduct>;
  create(params: ProductCreateParams): Promise<PlanSyncProduct>;
  search(params: { query: string; limit?: number }): Promise<{ data: PlanSyncProduct[] }>;
};

export type PlanSyncPricesAPI = {
  retrieve(id: string): Promise<PlanSyncPrice>;
  create(params: PriceCreateParams): Promise<PlanSyncPrice>;
  update(id: string, params: { active?: boolean }): Promise<PlanSyncPrice>;
  list(params: PriceListParams): Promise<{ data: PlanSyncPrice[] }>;
};

export type ProductUpdateParams = {
  name?: string;
  description?: string;
  active?: boolean;
  metadata?: Record<string, string>;
};
export type ProductCreateParams = {
  name: string;
  description?: string;
  active?: boolean;
  metadata?: Record<string, string>;
};
export type PriceCreateParams = {
  product: string;
  unit_amount: number;
  currency: string;
  recurring: { interval: "month" };
  metadata?: Record<string, string>;
};
export type PriceListParams = {
  product: string;
  active?: boolean;
  limit?: number;
};

export interface PlanSyncStripeClient {
  products: PlanSyncProductsAPI;
  prices: PlanSyncPricesAPI;
}

// ─── Public result type ─────────────────────────────────────────────────

export type PlanSyncResult =
  | {
      ok: true;
      kind:
        | "skipped_internal"
        | "skipped_free"
        | "created"
        | "updated"
        | "noop"
        | "archived";
      plan_id: string;
      stripe_product_id: string | null;
      stripe_price_id_monthly: string | null;
    }
  | { ok: false; reason: "stripe_error"; message: string };

// ─── Entry point ────────────────────────────────────────────────────────

export async function syncPlanToStripe(
  stripe: PlanSyncStripeClient,
  plan: Plan,
): Promise<PlanSyncResult> {
  if (plan.is_internal || plan.slug === INTERNAL_PLAN_SLUG) {
    return resultSkipped("skipped_internal", plan);
  }
  const amountCents = decimalToCents(plan.amount_monthly_usd);
  if (amountCents <= 0) {
    return resultSkipped("skipped_free", plan);
  }

  try {
    if (!plan.is_active) {
      return await archivePlanInStripe(stripe, plan);
    }

    const productResult = await ensureProduct(stripe, plan);
    const priceResult = await ensurePrice(
      stripe,
      plan,
      productResult.id,
      amountCents,
    );

    const noopProduct = plan.stripe_product_id === productResult.id;
    const noopPrice = plan.stripe_price_id_monthly === priceResult.id;
    const somethingChanged =
      productResult.created || priceResult.created || !noopProduct || !noopPrice;

    if (!somethingChanged) {
      return {
        ok: true,
        kind: "noop",
        plan_id: plan.id,
        stripe_product_id: productResult.id,
        stripe_price_id_monthly: priceResult.id,
      };
    }

    await prisma.plan.update({
      where: { id: plan.id },
      data: {
        stripe_product_id: productResult.id,
        stripe_price_id_monthly: priceResult.id,
      },
    });

    // "created" means: this Plan has never been synced before (no prior
    // Stripe Product). "updated" covers everything else — Product
    // discovered via search, Price drift, name refresh, etc.
    const kind =
      !plan.stripe_product_id && productResult.created ? "created" : "updated";

    return {
      ok: true,
      kind,
      plan_id: plan.id,
      stripe_product_id: productResult.id,
      stripe_price_id_monthly: priceResult.id,
    };
  } catch (err) {
    return {
      ok: false,
      reason: "stripe_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Archive path ───────────────────────────────────────────────────────
//
// When plan.is_active=false we deactivate the Stripe Product + Price so
// they stop appearing in Checkout dropdowns. If the Product/Price has
// been hard-deleted in Stripe (rare — Products with Prices can't be
// hard-deleted via the dashboard, but the API allows it), we clear the
// dangling id on the Plan row so the next reactivation creates fresh
// objects.

async function archivePlanInStripe(
  stripe: PlanSyncStripeClient,
  plan: Plan,
): Promise<PlanSyncResult> {
  let priceId: string | null = plan.stripe_price_id_monthly;
  let productId: string | null = plan.stripe_product_id;
  let needsDbWrite = false;

  if (priceId) {
    try {
      const existing = await stripe.prices.retrieve(priceId);
      if (existing.active) {
        await stripe.prices.update(priceId, { active: false });
      }
    } catch {
      // Stripe doesn't know this Price any more — clear the stale id.
      priceId = null;
      needsDbWrite = true;
    }
  }

  if (productId) {
    try {
      const existing = await stripe.products.retrieve(productId);
      if (existing.deleted) {
        productId = null;
        needsDbWrite = true;
      } else {
        // Stripe's `active` field isn't exposed on our narrow
        // PlanSyncProduct interface — call update unconditionally. The
        // call is idempotent.
        await stripe.products.update(productId, { active: false });
      }
    } catch {
      productId = null;
      needsDbWrite = true;
    }
  }

  if (
    needsDbWrite ||
    plan.stripe_product_id !== productId ||
    plan.stripe_price_id_monthly !== priceId
  ) {
    await prisma.plan.update({
      where: { id: plan.id },
      data: {
        stripe_product_id: productId,
        stripe_price_id_monthly: priceId,
      },
    });
  }

  return {
    ok: true,
    kind: "archived",
    plan_id: plan.id,
    stripe_product_id: productId,
    stripe_price_id_monthly: priceId,
  };
}

// ─── Product upsert ─────────────────────────────────────────────────────

type EnsureProductResult = { id: string; created: boolean };

async function ensureProduct(
  stripe: PlanSyncStripeClient,
  plan: Plan,
): Promise<EnsureProductResult> {
  if (plan.stripe_product_id) {
    const existing = await stripe.products.retrieve(plan.stripe_product_id);
    if (!existing.deleted) {
      await stripe.products.update(plan.stripe_product_id, {
        name: plan.name,
        description: plan.description ?? undefined,
        active: true,
        metadata: { plan_slug: plan.slug, plan_id: plan.id },
      });
      return { id: plan.stripe_product_id, created: false };
    }
  }

  const search = await stripe.products.search({
    query: `metadata['plan_slug']:'${plan.slug}'`,
    limit: 1,
  });
  const found = search.data[0];
  if (found && !found.deleted) {
    await stripe.products.update(found.id, {
      name: plan.name,
      description: plan.description ?? undefined,
      active: true,
      metadata: { plan_slug: plan.slug, plan_id: plan.id },
    });
    return { id: found.id, created: false };
  }

  const created = await stripe.products.create({
    name: plan.name,
    description: plan.description ?? undefined,
    active: true,
    metadata: { plan_slug: plan.slug, plan_id: plan.id },
  });
  return { id: created.id, created: true };
}

// ─── Price upsert ───────────────────────────────────────────────────────

type EnsurePriceResult = { id: string; created: boolean };

async function ensurePrice(
  stripe: PlanSyncStripeClient,
  plan: Plan,
  productId: string,
  amountCents: number,
): Promise<EnsurePriceResult> {
  if (plan.stripe_price_id_monthly) {
    let existing: PlanSyncPrice | null = null;
    try {
      existing = await stripe.prices.retrieve(plan.stripe_price_id_monthly);
    } catch {
      // Stripe doesn't know this Price any more. Fall through to the
      // discovery + create path so re-sync after a manual Stripe-side
      // delete (rare — Prices can normally only be archived) self-heals.
      existing = null;
    }
    if (existing) {
      const priceProduct =
        typeof existing.product === "string" ? existing.product : existing.product.id;
      const matches =
        existing.unit_amount === amountCents &&
        existing.currency === plan.currency &&
        existing.recurring?.interval === "month" &&
        priceProduct === productId;
      if (matches) {
        // Re-activate when matching — avoids creating duplicate Prices
        // on unarchive. Stripe Prices are immutable on amount, but
        // `active` is mutable.
        if (!existing.active) {
          await stripe.prices.update(existing.id, { active: true });
        }
        return { id: existing.id, created: false };
      }
      if (existing.active) {
        // Drift on amount/currency/interval — deactivate the stale
        // Price so it stops appearing in new Checkout sessions, then
        // fall through to create.
        await stripe.prices.update(existing.id, { active: false });
      }
    }
  }
  if (!plan.stripe_price_id_monthly) {
    const list = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 100,
    });
    const match = list.data.find(
      (p) =>
        p.unit_amount === amountCents &&
        p.currency === plan.currency &&
        p.recurring?.interval === "month",
    );
    if (match) return { id: match.id, created: false };
  }

  const created = await stripe.prices.create({
    product: productId,
    unit_amount: amountCents,
    currency: plan.currency,
    recurring: { interval: "month" },
    metadata: { plan_slug: plan.slug, plan_id: plan.id },
  });
  return { id: created.id, created: true };
}

// ─── Helpers ────────────────────────────────────────────────────────────

export function decimalToCents(raw: Plan["amount_monthly_usd"]): number {
  const s = raw.toString();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error(`amount_monthly_usd is not a positive 2dp decimal: ${s}`);
  }
  const [whole = "0", frac = ""] = s.split(".");
  const padded = (frac + "00").slice(0, 2);
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(padded || "0", 10);
}

function resultSkipped(
  kind: "skipped_internal" | "skipped_free",
  plan: Plan,
): PlanSyncResult {
  return {
    ok: true,
    kind,
    plan_id: plan.id,
    stripe_product_id: plan.stripe_product_id,
    stripe_price_id_monthly: plan.stripe_price_id_monthly,
  };
}
