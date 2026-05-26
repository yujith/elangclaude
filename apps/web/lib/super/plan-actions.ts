"use server";

// SuperAdmin-only server actions for Plan catalogue CRUD (ADR-0017
// Phase 1). Thin wrappers around the pure helpers in
// packages/db/src/plans.ts — auth + form parsing + redirects live here,
// validation + Prisma writes live there.
//
// Stripe synchronisation lands in Phase 2; these actions are intentionally
// local-only until then.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  archivePlanAsSuperAdmin,
  createPlanAsSuperAdmin,
  updatePlanAsSuperAdmin,
  type PlanCreateInput,
} from "@elc/db";
import { requireRole } from "@/lib/auth/context";

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

export async function createPlanFromForm(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const input = readCreateInput(formData);
  const result = await createPlanAsSuperAdmin(ctx, input);
  if (!result.ok) {
    redirect(`/plans/new?error=${result.reason}`);
  }
  revalidatePath("/plans");
  redirect(`/plans/${result.value.id}?created=1`);
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
  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  redirect(`/plans/${planId}?saved=1`);
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
  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  redirect(`/plans/${planId}?archived=1`);
}

