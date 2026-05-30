// SuperAdmin plan-catalogue helpers (ADR-0017 Phase 1).
//
// Plans are a GLOBAL model — every read and write goes through
// withSuperAdminContext(ctx). The role gate inside the helper throws if
// a non-SuperAdmin ever slips in. ActivityLog rows for plan CRUD land
// under SYSTEM_ORG_ID, never under a customer org (.claude/rules/multi-
// tenancy.md "Super-level events land under SYSTEM_ORG_ID").
//
// Stripe synchronisation is Phase 2 — Phase 1 keeps this module purely
// local. The Phase-2 code will read `stripe_product_id` /
// `stripe_price_id_monthly` on the rows we write here and upsert them
// against Stripe.

import { Prisma, type Plan } from "@prisma/client";
import { prisma } from "./client";
import { SYSTEM_ORG_ID } from "./system-org";
import { withSuperAdminContext, type OrgContext } from "./tenancy";

export const INTERNAL_PLAN_SLUG = "internal";
export const FREE_PLAN_SLUG = "free";

export type PlanFailureReason =
  | "plan_not_found"
  | "invalid_slug"
  | "invalid_name"
  | "invalid_description"
  | "invalid_seat_limit"
  | "invalid_quota_daily"
  | "invalid_quota_monthly"
  | "invalid_amount"
  | "invalid_trial_days"
  | "invalid_sort_order"
  | "slug_taken"
  | "internal_plan_immutable";

export type PlanResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: PlanFailureReason };

export type PlanCreateInput = {
  slug: string;
  name: string;
  description?: string | null;
  seat_limit: number;
  quota_daily: number;
  quota_monthly: number;
  amount_monthly_usd: string | number;
  trial_days: number;
  is_internal?: boolean;
  is_active?: boolean;
  sort_order?: number;
};

export type PlanUpdateInput = {
  name?: string;
  description?: string | null;
  seat_limit?: number;
  quota_daily?: number;
  quota_monthly?: number;
  amount_monthly_usd?: string | number;
  trial_days?: number;
  is_active?: boolean;
  sort_order?: number;
};

// ─── Validation ─────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z][a-z0-9-]{1,29}$/;

function normalizeSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return SLUG_RE.test(trimmed) ? trimmed : null;
}

function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 2 || trimmed.length > 100) return null;
  return trimmed;
}

function normalizeDescription(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 500) return undefined;
  return trimmed;
}

function normalizeInt(raw: unknown, min: number, max: number): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

// Accepts "49", "49.0", "49.00", "0", 49, etc. Returns a fixed-2-decimal
// string suitable for Prisma's Decimal column. Rejects negatives and
// anything beyond two fractional digits.
function normalizeAmount(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = typeof raw === "string" ? raw.trim() : String(raw);
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 99999.99) return null;
  return n.toFixed(2);
}

// ─── Reads ──────────────────────────────────────────────────────────────

export async function listPlansAsSuperAdmin(
  ctx: OrgContext,
  options: { includeInactive?: boolean } = {},
): Promise<Plan[]> {
  const db = withSuperAdminContext(ctx);
  return db.plan.findMany({
    where: options.includeInactive ? {} : { is_active: true },
    orderBy: [{ sort_order: "asc" }, { name: "asc" }],
  });
}

export async function getPlanByIdAsSuperAdmin(
  ctx: OrgContext,
  id: string,
): Promise<Plan | null> {
  const db = withSuperAdminContext(ctx);
  return db.plan.findUnique({ where: { id } });
}

// Used by the onboarding wizard (Phase 5) — picks a plan by stable slug
// when the user selects a tier card. SuperAdmin-context only because
// Plan is global; the wizard layer enforces its own auth.
export async function getPlanBySlugAsSuperAdmin(
  ctx: OrgContext,
  slug: string,
): Promise<Plan | null> {
  const db = withSuperAdminContext(ctx);
  const normalized = normalizeSlug(slug);
  if (!normalized) return null;
  return db.plan.findUnique({ where: { slug: normalized } });
}

// ─── Public read paths (no role gate) ───────────────────────────────────
//
// Plan is a global model — reading it doesn't leak tenant data. The
// onboarding wizard and the public /pricing page (Phase 6) need to
// list / fetch plans without holding SuperAdmin role, so we expose
// these as plain read helpers. Filters out internal plans by default
// because they exist for backfill, not for customers to subscribe to.

export async function listPlansForCustomer(): Promise<Plan[]> {
  return prisma.plan.findMany({
    where: { is_active: true, is_internal: false },
    orderBy: [{ sort_order: "asc" }, { name: "asc" }],
  });
}

export async function getActivePlanByIdForCustomer(
  id: string,
): Promise<Plan | null> {
  const plan = await prisma.plan.findUnique({ where: { id } });
  if (!plan) return null;
  if (!plan.is_active) return null;
  if (plan.is_internal) return null;
  return plan;
}

export async function getActivePlanBySlugForCustomer(
  slug: string,
): Promise<Plan | null> {
  const normalized = normalizeSlug(slug);
  if (!normalized) return null;
  const plan = await prisma.plan.findUnique({ where: { slug: normalized } });
  if (!plan || !plan.is_active || plan.is_internal) return null;
  return plan;
}

// ─── Writes ─────────────────────────────────────────────────────────────

export async function createPlanAsSuperAdmin(
  ctx: OrgContext,
  input: PlanCreateInput,
): Promise<PlanResult<Plan>> {
  const slug = normalizeSlug(input.slug);
  if (!slug) return { ok: false, reason: "invalid_slug" };
  const name = normalizeName(input.name);
  if (!name) return { ok: false, reason: "invalid_name" };
  const description = normalizeDescription(input.description);
  if (description === undefined && input.description !== undefined) {
    return { ok: false, reason: "invalid_description" };
  }
  const seat_limit = normalizeInt(input.seat_limit, 1, 100000);
  if (seat_limit === null) return { ok: false, reason: "invalid_seat_limit" };
  const quota_daily = normalizeInt(input.quota_daily, 0, 1000000);
  if (quota_daily === null) return { ok: false, reason: "invalid_quota_daily" };
  const quota_monthly = normalizeInt(input.quota_monthly, 0, 1000000);
  if (quota_monthly === null) {
    return { ok: false, reason: "invalid_quota_monthly" };
  }
  const amount = normalizeAmount(input.amount_monthly_usd);
  if (amount === null) return { ok: false, reason: "invalid_amount" };
  const trial_days = normalizeInt(input.trial_days, 0, 90);
  if (trial_days === null) return { ok: false, reason: "invalid_trial_days" };
  const sort_order = normalizeInt(input.sort_order ?? 100, 0, 10000);
  if (sort_order === null) return { ok: false, reason: "invalid_sort_order" };

  const db = withSuperAdminContext(ctx);
  try {
    const plan = await db.plan.create({
      data: {
        slug,
        name,
        description: description ?? null,
        seat_limit,
        quota_daily,
        quota_monthly,
        amount_monthly_usd: amount,
        trial_days,
        is_internal: input.is_internal ?? false,
        is_active: input.is_active ?? true,
        sort_order,
      },
    });
    await db.activityLog.create({
      data: {
        org_id: SYSTEM_ORG_ID,
        user_id: ctx.user_id,
        action: "super.plan.created",
        metadata: {
          plan_id: plan.id,
          slug: plan.slug,
          amount_monthly_usd: amount,
        } as Prisma.InputJsonValue,
      },
    });
    return { ok: true, value: plan };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { ok: false, reason: "slug_taken" };
    }
    throw err;
  }
}

export async function updatePlanAsSuperAdmin(
  ctx: OrgContext,
  id: string,
  input: PlanUpdateInput,
): Promise<PlanResult<Plan>> {
  const db = withSuperAdminContext(ctx);
  const existing = await db.plan.findUnique({ where: { id } });
  if (!existing) return { ok: false, reason: "plan_not_found" };
  if (existing.slug === INTERNAL_PLAN_SLUG) {
    // The internal plan is infrastructure; locking it down here matches
    // /orgs/[orgId] guarding the system org. SuperAdmin can still edit
    // its row directly via psql if they really mean to.
    return { ok: false, reason: "internal_plan_immutable" };
  }

  const data: Prisma.PlanUpdateInput = {};

  if (input.name !== undefined) {
    const name = normalizeName(input.name);
    if (!name) return { ok: false, reason: "invalid_name" };
    data.name = name;
  }
  if (input.description !== undefined) {
    const description = normalizeDescription(input.description);
    if (description === undefined) {
      return { ok: false, reason: "invalid_description" };
    }
    data.description = description;
  }
  if (input.seat_limit !== undefined) {
    const seat_limit = normalizeInt(input.seat_limit, 1, 100000);
    if (seat_limit === null) {
      return { ok: false, reason: "invalid_seat_limit" };
    }
    data.seat_limit = seat_limit;
  }
  if (input.quota_daily !== undefined) {
    const quota_daily = normalizeInt(input.quota_daily, 0, 1000000);
    if (quota_daily === null) {
      return { ok: false, reason: "invalid_quota_daily" };
    }
    data.quota_daily = quota_daily;
  }
  if (input.quota_monthly !== undefined) {
    const quota_monthly = normalizeInt(input.quota_monthly, 0, 1000000);
    if (quota_monthly === null) {
      return { ok: false, reason: "invalid_quota_monthly" };
    }
    data.quota_monthly = quota_monthly;
  }
  if (input.amount_monthly_usd !== undefined) {
    const amount = normalizeAmount(input.amount_monthly_usd);
    if (amount === null) return { ok: false, reason: "invalid_amount" };
    data.amount_monthly_usd = amount;
  }
  if (input.trial_days !== undefined) {
    const trial_days = normalizeInt(input.trial_days, 0, 90);
    if (trial_days === null) {
      return { ok: false, reason: "invalid_trial_days" };
    }
    data.trial_days = trial_days;
  }
  if (input.sort_order !== undefined) {
    const sort_order = normalizeInt(input.sort_order, 0, 10000);
    if (sort_order === null) {
      return { ok: false, reason: "invalid_sort_order" };
    }
    data.sort_order = sort_order;
  }
  if (input.is_active !== undefined) {
    data.is_active = input.is_active;
  }

  if (Object.keys(data).length === 0) {
    return { ok: true, value: existing };
  }

  const updated = await db.plan.update({ where: { id }, data });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "super.plan.updated",
      metadata: {
        plan_id: updated.id,
        slug: updated.slug,
        changed: Object.keys(data),
      } as Prisma.InputJsonValue,
    },
  });
  return { ok: true, value: updated };
}

export async function archivePlanAsSuperAdmin(
  ctx: OrgContext,
  id: string,
): Promise<PlanResult<Plan>> {
  const db = withSuperAdminContext(ctx);
  const existing = await db.plan.findUnique({ where: { id } });
  if (!existing) return { ok: false, reason: "plan_not_found" };
  if (existing.slug === INTERNAL_PLAN_SLUG) {
    return { ok: false, reason: "internal_plan_immutable" };
  }
  if (!existing.is_active) {
    return { ok: true, value: existing };
  }

  const updated = await db.plan.update({
    where: { id },
    data: { is_active: false },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "super.plan.archived",
      metadata: {
        plan_id: updated.id,
        slug: updated.slug,
      } as Prisma.InputJsonValue,
    },
  });
  return { ok: true, value: updated };
}

// Symmetric to archive — flip is_active back to true. Triggers a Stripe
// sync at the action layer so the Product + Price re-activate.
export async function reactivatePlanAsSuperAdmin(
  ctx: OrgContext,
  id: string,
): Promise<PlanResult<Plan>> {
  const db = withSuperAdminContext(ctx);
  const existing = await db.plan.findUnique({ where: { id } });
  if (!existing) return { ok: false, reason: "plan_not_found" };
  if (existing.slug === INTERNAL_PLAN_SLUG) {
    return { ok: false, reason: "internal_plan_immutable" };
  }
  if (existing.is_active) {
    return { ok: true, value: existing };
  }

  const updated = await db.plan.update({
    where: { id },
    data: { is_active: true },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "super.plan.reactivated",
      metadata: {
        plan_id: updated.id,
        slug: updated.slug,
      } as Prisma.InputJsonValue,
    },
  });
  return { ok: true, value: updated };
}
