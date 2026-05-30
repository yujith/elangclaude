"use server";

// SuperAdmin-only server actions for organisation CRUD.
//
// Organization is a global (non-tenant-scoped) model, so we read/write it
// via the unextended PrismaClient that withSuperAdminContext() returns.
// ActivityLog rows for super-level events go under SYSTEM_ORG_ID — never
// under the SuperAdmin's home org — so OrgAdmin views (which filter by
// their own org_id via withOrg()) never see super-level events.
//
// ADR-0017 Phase 3: createOrg now takes a required plan_id (seat/quota
// derive from the Plan) and an optional admin_email. When admin_email
// is supplied we create the Clerk Organization server-side and send a
// Clerk org-invitation so the admin lands in /onboarding/plan on first
// sign-in.

import { createClerkClient } from "@clerk/backend";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  Prisma,
  SYSTEM_ORG_ID,
  getPlanByIdAsSuperAdmin,
  withSuperAdminContext,
  type OrgStatus,
} from "@elc/db";
import { inviteOrgAdminForOrg } from "@elc/db/super-user-admin";
import { requireRole } from "@/lib/auth/context";

const NAME_MAX = 200;
// Generous ceiling — well above any realistic enterprise customer, low
// enough that a fat-finger typo doesn't produce a billion-seat org row.
const SEAT_LIMIT_MAX = 100_000;
const QUOTA_DAILY_MAX = 1_000_000;
const QUOTA_MONTHLY_MAX = 30_000_000;

export type OrgFormFailureReason =
  | "name_required"
  | "name_too_long"
  | "seat_limit_invalid"
  | "quota_daily_invalid"
  | "quota_monthly_invalid"
  | "invalid_status"
  | "system_org_immutable"
  | "not_found"
  // ADR-0017 Phase 3 — org-create with plan + optional admin invite.
  | "plan_required"
  | "plan_not_found"
  | "invalid_admin_email"
  | "clerk_org_create_failed"
  | "admin_invite_failed";

export type OrgInput = {
  name: string;
  seat_limit: number;
  quota_daily: number;
  quota_monthly: number;
};

export type CreateOrgResult =
  | { ok: true; org_id: string }
  | { ok: false; reason: OrgFormFailureReason };

export type UpdateOrgResult =
  | { ok: true }
  | { ok: false; reason: OrgFormFailureReason };

const VALID_STATUSES: ReadonlySet<OrgStatus> = new Set([
  "Active",
  "Suspended",
  "Archived",
]);

function normalizeName(raw: unknown): {
  ok: true;
  value: string;
} | {
  ok: false;
  reason: "name_required" | "name_too_long";
} {
  if (typeof raw !== "string") return { ok: false, reason: "name_required" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "name_required" };
  if (trimmed.length > NAME_MAX) return { ok: false, reason: "name_too_long" };
  return { ok: true, value: trimmed };
}

function parseNonNegativeInt(
  raw: unknown,
  max: number,
): number | null {
  const n =
    typeof raw === "string"
      ? Number.parseInt(raw, 10)
      : typeof raw === "number"
        ? raw
        : Number.NaN;
  if (!Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}

function parseOrgInput(input: {
  name: unknown;
  seat_limit: unknown;
  quota_daily: unknown;
  quota_monthly: unknown;
}):
  | { ok: true; value: OrgInput }
  | { ok: false; reason: OrgFormFailureReason } {
  const nameResult = normalizeName(input.name);
  if (!nameResult.ok) return { ok: false, reason: nameResult.reason };

  const seat = parseNonNegativeInt(input.seat_limit, SEAT_LIMIT_MAX);
  if (seat === null) return { ok: false, reason: "seat_limit_invalid" };

  const daily = parseNonNegativeInt(input.quota_daily, QUOTA_DAILY_MAX);
  if (daily === null) return { ok: false, reason: "quota_daily_invalid" };

  const monthly = parseNonNegativeInt(input.quota_monthly, QUOTA_MONTHLY_MAX);
  if (monthly === null) {
    return { ok: false, reason: "quota_monthly_invalid" };
  }

  return {
    ok: true,
    value: {
      name: nameResult.value,
      seat_limit: seat,
      quota_daily: daily,
      quota_monthly: monthly,
    },
  };
}

// ─── Programmatic entries (testable without booting Next) ─────────────────

// New shape for the ADR-0017 Phase 3 /orgs/new form. seat / quota
// derive from the chosen Plan; admin_email is optional (when set we
// also create the Clerk Organization and send the org invitation).
export async function createOrg(input: {
  name: unknown;
  plan_id: unknown;
  admin_email?: unknown;
  admin_name?: unknown;
}): Promise<CreateOrgResult> {
  const ctx = await requireRole("SuperAdmin");
  const nameResult = normalizeName(input.name);
  if (!nameResult.ok) return { ok: false, reason: nameResult.reason };

  if (typeof input.plan_id !== "string" || input.plan_id.length === 0) {
    return { ok: false, reason: "plan_required" };
  }
  const plan = await getPlanByIdAsSuperAdmin(ctx, input.plan_id);
  if (!plan || !plan.is_active) {
    return { ok: false, reason: "plan_not_found" };
  }

  // Optional admin email — when present, validate up front so we don't
  // create the Clerk Org just to fail on a typo.
  const adminEmail =
    input.admin_email !== undefined && input.admin_email !== null
      ? normalizeOptionalEmail(input.admin_email)
      : null;
  if (input.admin_email && adminEmail === null) {
    return { ok: false, reason: "invalid_admin_email" };
  }
  const adminName =
    typeof input.admin_name === "string" && input.admin_name.trim().length > 0
      ? input.admin_name.trim().slice(0, 200)
      : null;

  // Derive billing-side state from the Plan:
  //   - Free (amount=0) or is_internal → no Stripe, Org is immediately
  //     Internal so /post-signin sends the admin straight to /admin.
  //   - Otherwise → PendingPayment so /post-signin routes the admin
  //     through /onboarding/plan to complete Checkout.
  const amountStr = plan.amount_monthly_usd.toString();
  const isFreeOrInternal =
    plan.is_internal || amountStr === "0" || amountStr === "0.00";
  const subscriptionStatus: "Internal" | "PendingPayment" = isFreeOrInternal
    ? "Internal"
    : "PendingPayment";

  const db = withSuperAdminContext(ctx);
  const orgRow = await db.organization.create({
    data: {
      name: nameResult.value,
      seat_limit: plan.seat_limit,
      quota_daily: plan.quota_daily,
      quota_monthly: plan.quota_monthly,
      plan_id: plan.id,
      subscription_status: subscriptionStatus,
      provisioned_via: "invite",
    },
    select: { id: true },
  });

  // ── Clerk Organization side ────────────────────────────────────────
  // Only attempt when we have a SuperAdmin clerk_user_id (the createdBy
  // for the Clerk org) AND CLERK_SECRET_KEY is set. In dev without
  // those we still create the DB row so SuperAdmin can experiment;
  // when admin_email is supplied without env support, we surface
  // clerk_org_create_failed.
  let clerkOrgId: string | null = null;
  const wantsClerk = Boolean(adminEmail) && Boolean(process.env.CLERK_SECRET_KEY);
  if (wantsClerk) {
    const inviter = await db.user.findUnique({
      where: { id: ctx.user_id },
      select: { clerk_user_id: true },
    });
    if (!inviter?.clerk_user_id) {
      // SuperAdmin hasn't completed their own Clerk lazy-link yet — we
      // can't pass `createdBy` to Clerk. Roll back the Org row so a
      // retry after the SuperAdmin signs in once is clean.
      await db.organization.delete({ where: { id: orgRow.id } });
      return { ok: false, reason: "clerk_org_create_failed" };
    }
    try {
      const clerk = createClerkClient({
        secretKey: process.env.CLERK_SECRET_KEY!,
      });
      const clerkOrg = await clerk.organizations.createOrganization({
        name: nameResult.value,
        createdBy: inviter.clerk_user_id,
      });
      clerkOrgId = clerkOrg.id;
      await db.organization.update({
        where: { id: orgRow.id },
        data: { clerk_org_id: clerkOrgId },
      });
    } catch (err) {
      console.error("[createOrg] Clerk Org creation failed", err);
      await db.organization.delete({ where: { id: orgRow.id } });
      return { ok: false, reason: "clerk_org_create_failed" };
    }
  }

  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "super.org.created",
      metadata: {
        org_id: orgRow.id,
        name: nameResult.value,
        plan_slug: plan.slug,
        subscription_status: subscriptionStatus,
        clerk_org_id: clerkOrgId,
      } as Prisma.InputJsonValue,
    },
  });

  // ── Optional admin invite ──────────────────────────────────────────
  // The pure helper handles creating the DB User + sending the Clerk
  // organization-level invitation + stamping billing_owner_user_id.
  // We pass skipClerkInvitation=true if we couldn't create a Clerk Org
  // (no env) so the DB row still lands; SuperAdmin can re-invite from
  // /orgs/[orgId]/users once env is configured.
  if (adminEmail) {
    const inviteResult = await inviteOrgAdminForOrg(
      ctx,
      { org_id: orgRow.id, email: adminEmail, name: adminName },
      { skipClerkInvitation: !wantsClerk },
    );
    if (!inviteResult.ok) {
      console.warn(
        "[createOrg] admin invite failed; Org row preserved for retry",
        inviteResult.reason,
      );
      // We deliberately do NOT roll back the Org — the SuperAdmin can
      // retry the invite from /orgs/[orgId]/users. Surface as a
      // non-fatal "admin_invite_failed" so the redirect lands on
      // /orgs/[id] with a flash that explains what to do next.
      return {
        ok: false,
        reason: "admin_invite_failed",
      };
    }
  }

  return { ok: true, org_id: orgRow.id };
}

function normalizeOptionalEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

export async function updateOrgSettings(input: {
  org_id: unknown;
  name: unknown;
  seat_limit: unknown;
  quota_daily: unknown;
  quota_monthly: unknown;
}): Promise<UpdateOrgResult> {
  const ctx = await requireRole("SuperAdmin");
  if (typeof input.org_id !== "string" || input.org_id.length === 0) {
    return { ok: false, reason: "not_found" };
  }
  if (input.org_id === SYSTEM_ORG_ID) {
    return { ok: false, reason: "system_org_immutable" };
  }
  const parsed = parseOrgInput(input);
  if (!parsed.ok) return parsed;
  const db = withSuperAdminContext(ctx);

  const existing = await db.organization.findUnique({
    where: { id: input.org_id },
    select: {
      name: true,
      seat_limit: true,
      quota_daily: true,
      quota_monthly: true,
    },
  });
  if (!existing) return { ok: false, reason: "not_found" };

  await db.organization.update({
    where: { id: input.org_id },
    data: { ...parsed.value },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "super.org.updated",
      metadata: {
        org_id: input.org_id,
        before: existing,
        after: parsed.value,
      } as Prisma.InputJsonValue,
    },
  });
  return { ok: true };
}

export async function setOrgStatus(input: {
  org_id: unknown;
  status: unknown;
}): Promise<UpdateOrgResult> {
  const ctx = await requireRole("SuperAdmin");
  if (typeof input.org_id !== "string" || input.org_id.length === 0) {
    return { ok: false, reason: "not_found" };
  }
  if (input.org_id === SYSTEM_ORG_ID) {
    return { ok: false, reason: "system_org_immutable" };
  }
  if (
    typeof input.status !== "string" ||
    !VALID_STATUSES.has(input.status as OrgStatus)
  ) {
    return { ok: false, reason: "invalid_status" };
  }
  const status = input.status as OrgStatus;
  const db = withSuperAdminContext(ctx);

  const existing = await db.organization.findUnique({
    where: { id: input.org_id },
    select: { status: true },
  });
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status === status) {
    // No-op — keep the log clean.
    return { ok: true };
  }

  await db.organization.update({
    where: { id: input.org_id },
    data: { status },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "super.org.status_changed",
      metadata: {
        org_id: input.org_id,
        before: existing.status,
        after: status,
      } as Prisma.InputJsonValue,
    },
  });
  return { ok: true };
}

// ─── Form-action wrappers ────────────────────────────────────────────────

export async function createOrgFromForm(formData: FormData): Promise<void> {
  const result = await createOrg({
    name: formData.get("name"),
    plan_id: formData.get("plan_id"),
    admin_email: formData.get("admin_email"),
    admin_name: formData.get("admin_name"),
  });
  if (!result.ok) {
    // For admin_invite_failed we still want the Org page to load so the
    // SuperAdmin can re-invite. createOrg returns the Org id only on
    // ok:true, but in admin_invite_failed the Org row exists — read
    // back the most-recent Org owned by this SuperAdmin? Cleaner path:
    // route to /orgs with a flash so they can find it manually.
    redirect(`/orgs/new?error=${result.reason}`);
  }
  revalidatePath("/orgs");
  redirect(`/orgs/${result.org_id}?created=1`);
}

export async function updateOrgSettingsFromForm(
  formData: FormData,
): Promise<void> {
  const orgIdRaw = formData.get("org_id");
  const orgId =
    typeof orgIdRaw === "string" && orgIdRaw.length > 0 ? orgIdRaw : null;
  const result = await updateOrgSettings({
    org_id: orgIdRaw,
    name: formData.get("name"),
    seat_limit: formData.get("seat_limit"),
    quota_daily: formData.get("quota_daily"),
    quota_monthly: formData.get("quota_monthly"),
  });
  if (!result.ok) {
    if (orgId) redirect(`/orgs/${orgId}?error=${result.reason}`);
    redirect(`/orgs?error=${result.reason}`);
  }
  revalidatePath("/orgs");
  if (orgId) revalidatePath(`/orgs/${orgId}`);
  redirect(`/orgs/${orgId}?saved=1`);
}

export async function setOrgStatusFromForm(formData: FormData): Promise<void> {
  const orgIdRaw = formData.get("org_id");
  const orgId =
    typeof orgIdRaw === "string" && orgIdRaw.length > 0 ? orgIdRaw : null;
  const result = await setOrgStatus({
    org_id: orgIdRaw,
    status: formData.get("status"),
  });
  if (!result.ok) {
    if (orgId) redirect(`/orgs/${orgId}?error=${result.reason}`);
    redirect(`/orgs?error=${result.reason}`);
  }
  revalidatePath("/orgs");
  if (orgId) revalidatePath(`/orgs/${orgId}`);
  redirect(`/orgs/${orgId}?status_changed=1`);
}
