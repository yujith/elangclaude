"use server";

// SuperAdmin-only server actions for Plan catalogue CRUD (ADR-0017
// Phase 1 + Phase 2 Stripe sync). Thin wrappers around the pure helpers
// in packages/db/src/plans.ts — auth + form parsing + redirects live
// here, validation + Prisma writes live there.
//
// Phase 2: every successful create / update kicks off a Stripe Product
// + Price upsert via apps/web/lib/billing/plan-sync.ts. Stripe failures
// do NOT roll back the DB Plan row — the Plan is the source of truth
// (ADR-0017 D5). A sync failure surfaces as a flash banner so the
// SuperAdmin can hit "Re-sync to Stripe" once Stripe is back.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  archivePlanAsSuperAdmin,
  createPlanAsSuperAdmin,
  getPlanByIdAsSuperAdmin,
  listPlansAsSuperAdmin,
  reactivatePlanAsSuperAdmin,
  syncPlanToStripe,
  updatePlanAsSuperAdmin,
  type PlanCreateInput,
  type PlanSyncStripeClient,
} from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import { getStripe } from "@/lib/billing/stripe-client";

function asString(raw: FormDataEntryValue | null): string {
  return typeof raw === "string" ? raw : "";
}

function asOptionalBool(raw: FormDataEntryValue | null): boolean {
  return raw === "on" || raw === "true" || raw === "1";
}

function readCreateInput(formData: FormData): PlanCreateInput {
  return {
    slug: asString(formData.get("slug")),
    name: asString(formData.get("name")),
    description: asString(formData.get("description")) || null,
    seat_limit: Number.parseInt(asString(formData.get("seat_limit")), 10),
    quota_daily: Number.parseInt(asString(formData.get("quota_daily")), 10),
    quota_monthly: Number.parseInt(asString(formData.get("quota_monthly")), 10),
    amount_monthly_usd: asString(formData.get("amount_monthly_usd")),
    trial_days: Number.parseInt(asString(formData.get("trial_days")), 10),
    sort_order: Number.parseInt(asString(formData.get("sort_order")), 10),
    is_active: asOptionalBool(formData.get("is_active")),
  };
}

// Run plan-sync against the live Stripe client. Returns null on success
// or a short reason string on failure (used as the ?stripe_sync= query
// param). Reads the freshest Plan row from DB so the sync sees any
// stripe_*_id stamped by a prior partial sync.
async function trySyncPlanToStripe(planId: string): Promise<string | null> {
  try {
    // The real Stripe SDK's `products` / `prices` namespaces are
    // structurally compatible with the narrow PlanSyncStripeClient
    // interface — cast keeps the package-boundary clean (packages/db
    // doesn't import the Stripe SDK).
    const stripe = getStripe() as unknown as PlanSyncStripeClient;
    const fresh = await getPlanByIdAsSuperAdmin(
      { org_id: "system", user_id: "system", role: "SuperAdmin" },
      planId,
    );
    if (!fresh) return "plan_not_found";
    const result = await syncPlanToStripe(stripe, fresh);
    if (!result.ok) return "stripe_error";
    return null;
  } catch (err) {
    // BillingEnvError or any other unexpected throw — surface as a flash
    // banner but don't crash the action. The Plan row is intact.
    console.error("[plan-actions] Stripe sync failed", err);
    return "stripe_error";
  }
}

export async function createPlanFromForm(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const input = readCreateInput(formData);
  const result = await createPlanAsSuperAdmin(ctx, input);
  if (!result.ok) {
    redirect(`/plans/new?error=${result.reason}`);
  }
  const syncError = await trySyncPlanToStripe(result.value.id);
  revalidatePath("/plans");
  const params = new URLSearchParams({ created: "1" });
  if (syncError) params.set("stripe_sync", syncError);
  redirect(`/plans/${result.value.id}?${params.toString()}`);
}

export async function updatePlanFromForm(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const planIdRaw = formData.get("plan_id");
  const planId =
    typeof planIdRaw === "string" && planIdRaw.length > 0 ? planIdRaw : null;
  if (!planId) redirect(`/plans?error=plan_not_found`);

  const result = await updatePlanAsSuperAdmin(ctx, planId, {
    name: asString(formData.get("name")),
    description: asString(formData.get("description")) || null,
    seat_limit: Number.parseInt(asString(formData.get("seat_limit")), 10),
    quota_daily: Number.parseInt(asString(formData.get("quota_daily")), 10),
    quota_monthly: Number.parseInt(asString(formData.get("quota_monthly")), 10),
    amount_monthly_usd: asString(formData.get("amount_monthly_usd")),
    trial_days: Number.parseInt(asString(formData.get("trial_days")), 10),
    sort_order: Number.parseInt(asString(formData.get("sort_order")), 10),
    is_active: asOptionalBool(formData.get("is_active")),
  });
  if (!result.ok) {
    redirect(`/plans/${planId}?error=${result.reason}`);
  }
  const syncError = await trySyncPlanToStripe(planId);
  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  const params = new URLSearchParams({ saved: "1" });
  if (syncError) params.set("stripe_sync", syncError);
  redirect(`/plans/${planId}?${params.toString()}`);
}

export async function archivePlanFromForm(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const planIdRaw = formData.get("plan_id");
  const planId =
    typeof planIdRaw === "string" && planIdRaw.length > 0 ? planIdRaw : null;
  if (!planId) redirect(`/plans?error=plan_not_found`);

  const result = await archivePlanAsSuperAdmin(ctx, planId);
  if (!result.ok) {
    redirect(`/plans/${planId}?error=${result.reason}`);
  }
  // Push the archive through to Stripe so the Product + monthly Price
  // are deactivated. Failure surfaces as a flash banner (Phase 2 fix —
  // a Stripe outage shouldn't block the local archive).
  const syncError = await trySyncPlanToStripe(planId);
  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  const params = new URLSearchParams({ archived: "1" });
  if (syncError) params.set("stripe_sync", syncError);
  redirect(`/plans/${planId}?${params.toString()}`);
}

export async function reactivatePlanFromForm(
  formData: FormData,
): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const planIdRaw = formData.get("plan_id");
  const planId =
    typeof planIdRaw === "string" && planIdRaw.length > 0 ? planIdRaw : null;
  if (!planId) redirect(`/plans?error=plan_not_found`);

  const result = await reactivatePlanAsSuperAdmin(ctx, planId);
  if (!result.ok) {
    redirect(`/plans/${planId}?error=${result.reason}`);
  }
  // Sync to Stripe — re-activate the Product + Price so it reappears in
  // Checkout. Failure surfaces as a flash banner; the DB row is already
  // reactivated.
  const syncError = await trySyncPlanToStripe(planId);
  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  const params = new URLSearchParams({ reactivated: "1" });
  if (syncError) params.set("stripe_sync", syncError);
  redirect(`/plans/${planId}?${params.toString()}`);
}

// Bulk recovery — sweep every non-internal, non-free active plan
// through Stripe sync. Used after a fresh seed (where the plan rows
// were upserted directly into the DB and never went through the
// auto-sync path on save) or after a Stripe-side outage. Idempotent:
// re-running on already-synced plans is a noop per Phase 2's logic.
export async function syncAllPaidPlansFromForm(): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const plans = await listPlansAsSuperAdmin(ctx, { includeInactive: false });

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const plan of plans) {
    if (plan.is_internal) {
      skipped += 1;
      continue;
    }
    const amountStr = plan.amount_monthly_usd.toString();
    if (amountStr === "0" || amountStr === "0.00") {
      skipped += 1;
      continue;
    }
    const err = await trySyncPlanToStripe(plan.id);
    if (err) failed += 1;
    else synced += 1;
  }

  revalidatePath("/plans");
  const params = new URLSearchParams({
    bulk_synced: synced.toString(),
    bulk_skipped: skipped.toString(),
    bulk_failed: failed.toString(),
  });
  redirect(`/plans?${params.toString()}`);
}

// Manual recovery — clicked when the create/update sync banner shows
// "Stripe sync failed". Pure side-effect: doesn't change the DB Plan
// row, just retries the Stripe push.
export async function resyncPlanFromForm(formData: FormData): Promise<void> {
  await requireRole("SuperAdmin");
  const planIdRaw = formData.get("plan_id");
  const planId =
    typeof planIdRaw === "string" && planIdRaw.length > 0 ? planIdRaw : null;
  if (!planId) redirect(`/plans?error=plan_not_found`);

  const syncError = await trySyncPlanToStripe(planId);
  revalidatePath(`/plans/${planId}`);
  const params = new URLSearchParams();
  if (syncError) params.set("stripe_sync", syncError);
  else params.set("stripe_synced", "1");
  redirect(`/plans/${planId}?${params.toString()}`);
}
