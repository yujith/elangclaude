// Self-serve org provisioning (ADR-0017 Phase 6).
//
// Called from /signup-org/continue after Clerk has authenticated the
// fresh user. We create:
//   1. The Clerk Organization (so Clerk's UI knows about it).
//   2. The DB Organization row (with plan_id + subscription_status).
//   3. The DB User row for the OrgAdmin (role=OrgAdmin, clerk_user_id
//      stamped so requireOrgContext takes the fast path on next req).
//   4. Stamp billing_owner_user_id on the Org.
//   5. Best-effort: add the OrgAdmin to the Clerk Org as org:admin.
//      If this fails it's logged but non-fatal — our auth path keys off
//      the DB User row, not Clerk org membership.
//
// Single-org constraint: until ADR-0018 (multi-org schema) lands, an
// email can only exist in one Org. If the visitor's email is already
// in our DB (e.g. they were invited as a Learner elsewhere), we refuse
// with `email_already_in_use`. They can sign in to that existing Org
// instead.

import { Prisma } from "@prisma/client";
import { prisma } from "./client";
import { SYSTEM_ORG_ID } from "./system-org";
import { FREE_PLAN_SLUG, INTERNAL_PLAN_SLUG } from "./plans";

// ─── Public types ───────────────────────────────────────────────────────

export type SelfServeFailureReason =
  | "invalid_org_name"
  | "invalid_plan_slug"
  | "plan_not_found"
  | "plan_inactive"
  | "plan_internal"
  | "email_already_in_use"
  | "clerk_org_create_failed";

export type SelfServeProvisionResult =
  | {
      ok: true;
      org_id: string;
      user_id: string;
      plan_slug: string;
      subscription_status: "PendingPayment" | "Internal";
    }
  | { ok: false; reason: SelfServeFailureReason };

// Injection points so vitest can stub Clerk without booting the SDK.

export type CreateClerkOrgFn = (params: {
  name: string;
  createdBy: string;
}) => Promise<{ id: string }>;

export type CreateClerkOrgMembershipFn = (params: {
  organizationId: string;
  userId: string;
  role: string;
}) => Promise<{ id: string } | void>;

export type DeleteClerkOrgFn = (id: string) => Promise<void>;

export interface SelfServeProvisionInput {
  clerk_user_id: string;
  email: string;
  org_name: string;
  plan_slug: string;
  user_name?: string | null;
}

export interface SelfServeProvisionOptions {
  createClerkOrg: CreateClerkOrgFn;
  createClerkOrgMembership: CreateClerkOrgMembershipFn;
  /** Cleanup hook if DB writes fail after Clerk Org was created. Tests
   *  can stub a no-op; production passes a real Clerk delete call. */
  deleteClerkOrg?: DeleteClerkOrgFn;
}

// ─── Validation ─────────────────────────────────────────────────────────

const ORG_NAME_MIN = 2;
const ORG_NAME_MAX = 120;
const SLUG_RE = /^[a-z][a-z0-9-]{1,29}$/;

function normalizeOrgName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < ORG_NAME_MIN || trimmed.length > ORG_NAME_MAX) return null;
  return trimmed;
}

function normalizeSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const lowered = raw.trim().toLowerCase();
  return SLUG_RE.test(lowered) ? lowered : null;
}

function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

// ─── Entry point ────────────────────────────────────────────────────────

export async function provisionSelfServeOrg(
  input: SelfServeProvisionInput,
  options: SelfServeProvisionOptions,
): Promise<SelfServeProvisionResult> {
  const orgName = normalizeOrgName(input.org_name);
  if (!orgName) return { ok: false, reason: "invalid_org_name" };
  const slug = normalizeSlug(input.plan_slug);
  if (!slug) return { ok: false, reason: "invalid_plan_slug" };
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, reason: "email_already_in_use" };
  const userName =
    typeof input.user_name === "string" && input.user_name.trim().length > 0
      ? input.user_name.trim().slice(0, 200)
      : null;

  // Plan lookup — refuse internal and inactive plans up front.
  const plan = await prisma.plan.findUnique({ where: { slug } });
  if (!plan) return { ok: false, reason: "plan_not_found" };
  if (!plan.is_active) return { ok: false, reason: "plan_inactive" };
  if (plan.is_internal || plan.slug === INTERNAL_PLAN_SLUG) {
    return { ok: false, reason: "plan_internal" };
  }

  // Single-org constraint (pre-ADR-0018). Refuse if this email or
  // Clerk user id is already in our DB.
  const existingByEmail = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existingByEmail) return { ok: false, reason: "email_already_in_use" };
  const existingByClerk = await prisma.user.findUnique({
    where: { clerk_user_id: input.clerk_user_id },
    select: { id: true },
  });
  if (existingByClerk) return { ok: false, reason: "email_already_in_use" };

  // Derive billing-side state (see ADR-0017 D4).
  const amountStr = plan.amount_monthly_usd.toString();
  const isFree =
    plan.slug === FREE_PLAN_SLUG ||
    amountStr === "0" ||
    amountStr === "0.00";
  const subscriptionStatus: "PendingPayment" | "Internal" = isFree
    ? "Internal"
    : "PendingPayment";

  // ── Clerk Org create ───────────────────────────────────────────────
  let clerkOrgId: string;
  try {
    const created = await options.createClerkOrg({
      name: orgName,
      createdBy: input.clerk_user_id,
    });
    clerkOrgId = created.id;
  } catch (err) {
    console.error("[self-serve] Clerk Org creation failed", err);
    return { ok: false, reason: "clerk_org_create_failed" };
  }

  // ── DB writes (Org + User + billing-owner stamp + logs) ────────────
  // Wrapped in a single transaction so a half-create can't leave
  // dangling state. If this throws we attempt to clean up the Clerk
  // Org so the next provision attempt starts fresh.
  let dbOrgId: string;
  let dbUserId: string;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: orgName,
          clerk_org_id: clerkOrgId,
          plan_id: plan.id,
          subscription_status: subscriptionStatus,
          provisioned_via: "self_serve",
          status: "Active",
          seat_limit: plan.seat_limit,
          quota_daily: plan.quota_daily,
          quota_monthly: plan.quota_monthly,
        },
        select: { id: true },
      });
      const user = await tx.user.create({
        data: {
          org_id: org.id,
          email,
          name: userName,
          role: "OrgAdmin",
          clerk_user_id: input.clerk_user_id,
        },
        select: { id: true },
      });
      await tx.organization.update({
        where: { id: org.id },
        data: { billing_owner_user_id: user.id },
      });
      await tx.activityLog.create({
        data: {
          org_id: org.id,
          user_id: user.id,
          action: "org.self_serve_created",
          metadata: {
            plan_slug: plan.slug,
            subscription_status: subscriptionStatus,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.activityLog.create({
        data: {
          org_id: SYSTEM_ORG_ID,
          user_id: user.id,
          action: "super.org.self_serve_created",
          metadata: {
            org_id: org.id,
            plan_slug: plan.slug,
            email,
            clerk_org_id: clerkOrgId,
          } as Prisma.InputJsonValue,
        },
      });
      return { orgId: org.id, userId: user.id };
    });
    dbOrgId = result.orgId;
    dbUserId = result.userId;
  } catch (err) {
    console.error("[self-serve] DB writes failed; cleaning up Clerk Org", err);
    if (options.deleteClerkOrg) {
      await options.deleteClerkOrg(clerkOrgId).catch((cleanupErr) => {
        console.error("[self-serve] Clerk Org cleanup failed", cleanupErr);
      });
    }
    return { ok: false, reason: "clerk_org_create_failed" };
  }

  // ── Best-effort Clerk Org membership ───────────────────────────────
  // Failure here is non-fatal: requireOrgContext keys off the DB User
  // row, not Clerk membership. The OrgAdmin can still complete the
  // onboarding wizard. We log so it's visible but don't fail the path.
  try {
    await options.createClerkOrgMembership({
      organizationId: clerkOrgId,
      userId: input.clerk_user_id,
      role: "org:admin",
    });
  } catch (err) {
    console.warn(
      "[self-serve] Clerk Org membership creation failed (non-fatal)",
      err,
    );
  }

  return {
    ok: true,
    org_id: dbOrgId,
    user_id: dbUserId,
    plan_slug: plan.slug,
    subscription_status: subscriptionStatus,
  };
}
