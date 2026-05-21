// Phase 2 — per-org user management for SuperAdmins.
//
// Pure DB-touching helpers. apps/web/lib/super/user-actions.ts is the
// thin server-action wrapper that runs requireRole("SuperAdmin") and
// forwards to these functions. Keeping the logic here means the
// last-admin / cross-org / soft-delete invariants are testable in
// vitest without booting Next.
//
// All writes go through withSuperAdminContext(ctx) — these are cross-org
// operations by definition, so withOrg() is intentionally NOT used. The
// User and ActivityLog tables ARE tenant-scoped, so withSuperAdminContext
// is required (the role check inside throws if a non-SuperAdmin slips
// through). Super-level ActivityLog rows go under SYSTEM_ORG_ID.

import { Prisma, type Role } from "@prisma/client";
import { prisma } from "./client";
import { SYSTEM_ORG_ID } from "./system-org";
import { withSuperAdminContext, type OrgContext } from "./tenancy";

export type SuperUserFailureReason =
  | "invalid_email"
  | "cannot_invite"
  | "org_not_found"
  | "user_not_found"
  | "user_deleted"
  | "invalid_role"
  | "cannot_change_super_admin"
  | "last_admin"
  // The caller passed an expected_org_id (typically from a hidden form
  // field on the per-org users page) that doesn't match the looked-up
  // user.org_id. Refusing rather than acting on the mismatch defends
  // against a tampered or stale form and keeps the action semantics
  // tight: "this control on org A's page acts on org A's users".
  | "org_mismatch";

export type InviteOrgAdminResult =
  | { ok: true; user_id: string; alreadyExisted: boolean }
  | { ok: false; reason: SuperUserFailureReason };

export type SuperUserResult =
  | { ok: true }
  | { ok: false; reason: SuperUserFailureReason };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ASSIGNABLE_ROLES: ReadonlySet<Role> = new Set<Role>(["OrgAdmin", "Learner"]);

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}

function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 200);
}

// Counts active (not soft-deleted) OrgAdmins in an org. Used to enforce
// the last-admin invariant on demote / soft-delete.
async function countActiveOrgAdmins(
  db: ReturnType<typeof withSuperAdminContext>,
  org_id: string,
  excludeUserId?: string,
): Promise<number> {
  return db.user.count({
    where: {
      org_id,
      role: "OrgAdmin",
      deleted_at: null,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
  });
}

export async function inviteOrgAdminForOrg(
  ctx: OrgContext,
  input: { org_id: string; email: string; name?: string | null },
): Promise<InviteOrgAdminResult> {
  const db = withSuperAdminContext(ctx);
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, reason: "invalid_email" };
  const name = normalizeName(input.name);

  if (input.org_id === SYSTEM_ORG_ID) {
    return { ok: false, reason: "org_not_found" };
  }
  const org = await db.organization.findUnique({
    where: { id: input.org_id },
    select: { id: true },
  });
  if (!org) return { ok: false, reason: "org_not_found" };

  // Intentional cross-org lookup. If the email is in use by ANY other
  // org, refuse generically — never leak which org owns it.
  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, org_id: true, role: true, deleted_at: true },
  });
  if (existing && existing.org_id !== input.org_id) {
    return { ok: false, reason: "cannot_invite" };
  }
  if (existing && existing.deleted_at !== null) {
    // Same org, but soft-deleted. Refusing here keeps "remove" final
    // until an explicit restore flow exists; the alternative (silently
    // un-delete) would surprise an admin who removed someone yesterday.
    return { ok: false, reason: "cannot_invite" };
  }
  if (existing && existing.role === "OrgAdmin") {
    return { ok: true, user_id: existing.id, alreadyExisted: true };
  }
  if (existing && existing.role === "SuperAdmin") {
    return { ok: false, reason: "cannot_change_super_admin" };
  }
  // Same-org Learner: promote to OrgAdmin in place rather than fail —
  // a SuperAdmin clicking "invite as OrgAdmin" for an existing learner
  // email obviously wants that user to become an admin.
  if (existing && existing.role === "Learner") {
    await db.user.update({
      where: { id: existing.id },
      data: { role: "OrgAdmin", name: name ?? undefined },
    });
    await db.activityLog.create({
      data: {
        org_id: SYSTEM_ORG_ID,
        user_id: ctx.user_id,
        action: "super.user.role_changed",
        metadata: {
          org_id: input.org_id,
          target_user_id: existing.id,
          from: "Learner",
          to: "OrgAdmin",
        } as Prisma.InputJsonValue,
      },
    });
    return { ok: true, user_id: existing.id, alreadyExisted: true };
  }

  const created = await db.user.create({
    data: {
      org_id: input.org_id,
      email,
      name,
      role: "OrgAdmin",
      ielts_track: "Academic",
    },
    select: { id: true },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "super.user.invited",
      metadata: {
        org_id: input.org_id,
        target_user_id: created.id,
        target_email: email,
        target_role: "OrgAdmin",
      } as Prisma.InputJsonValue,
    },
  });
  return { ok: true, user_id: created.id, alreadyExisted: false };
}

export async function setUserRoleAsSuperAdmin(
  ctx: OrgContext,
  input: { user_id: string; role: Role; expected_org_id?: string },
): Promise<SuperUserResult> {
  const db = withSuperAdminContext(ctx);
  if (!ASSIGNABLE_ROLES.has(input.role)) {
    return { ok: false, reason: "invalid_role" };
  }
  const user = await db.user.findUnique({
    where: { id: input.user_id },
    select: { id: true, org_id: true, role: true, deleted_at: true },
  });
  if (!user) return { ok: false, reason: "user_not_found" };
  if (
    input.expected_org_id !== undefined &&
    input.expected_org_id !== user.org_id
  ) {
    return { ok: false, reason: "org_mismatch" };
  }
  if (user.deleted_at !== null) return { ok: false, reason: "user_deleted" };
  if (user.role === "SuperAdmin") {
    return { ok: false, reason: "cannot_change_super_admin" };
  }
  if (user.role === input.role) {
    // No-op success; nothing to log.
    return { ok: true };
  }

  // Demoting the last active OrgAdmin would leave the org un-administerable
  // — refuse so support has to pick an alternative admin first.
  if (user.role === "OrgAdmin" && input.role === "Learner") {
    const remaining = await countActiveOrgAdmins(db, user.org_id, user.id);
    if (remaining === 0) return { ok: false, reason: "last_admin" };
  }

  await db.user.update({
    where: { id: user.id },
    data: { role: input.role },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "super.user.role_changed",
      metadata: {
        org_id: user.org_id,
        target_user_id: user.id,
        from: user.role,
        to: input.role,
      } as Prisma.InputJsonValue,
    },
  });
  return { ok: true };
}

export async function resetUserQuotaTodayAsSuperAdmin(
  ctx: OrgContext,
  input: { user_id: string; expected_org_id?: string },
): Promise<SuperUserResult> {
  const db = withSuperAdminContext(ctx);
  const user = await db.user.findUnique({
    where: { id: input.user_id },
    select: { id: true, org_id: true, deleted_at: true },
  });
  if (!user) return { ok: false, reason: "user_not_found" };
  if (
    input.expected_org_id !== undefined &&
    input.expected_org_id !== user.org_id
  ) {
    return { ok: false, reason: "org_mismatch" };
  }
  if (user.deleted_at !== null) return { ok: false, reason: "user_deleted" };

  const today = startOfUtcToday();
  await db.quotaUsage.upsert({
    where: { user_id_date: { user_id: user.id, date: today } },
    update: { ai_calls_count: 0 },
    create: {
      org_id: user.org_id,
      user_id: user.id,
      date: today,
      ai_calls_count: 0,
    },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "super.user.quota_reset",
      metadata: {
        org_id: user.org_id,
        target_user_id: user.id,
        date: today.toISOString().slice(0, 10),
      } as Prisma.InputJsonValue,
    },
  });
  return { ok: true };
}

export async function softDeleteUserAsSuperAdmin(
  ctx: OrgContext,
  input: { user_id: string; expected_org_id?: string },
): Promise<SuperUserResult> {
  const db = withSuperAdminContext(ctx);
  const user = await db.user.findUnique({
    where: { id: input.user_id },
    select: { id: true, org_id: true, role: true, deleted_at: true },
  });
  if (!user) return { ok: false, reason: "user_not_found" };
  if (
    input.expected_org_id !== undefined &&
    input.expected_org_id !== user.org_id
  ) {
    return { ok: false, reason: "org_mismatch" };
  }
  if (user.deleted_at !== null) {
    // Idempotent: already soft-deleted is success without a fresh log row.
    return { ok: true };
  }
  if (user.role === "SuperAdmin") {
    return { ok: false, reason: "cannot_change_super_admin" };
  }
  // Removing the last active OrgAdmin would leave the org un-administerable.
  if (user.role === "OrgAdmin") {
    const remaining = await countActiveOrgAdmins(db, user.org_id, user.id);
    if (remaining === 0) return { ok: false, reason: "last_admin" };
  }

  await db.user.update({
    where: { id: user.id },
    data: { deleted_at: new Date() },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "super.user.removed",
      metadata: {
        org_id: user.org_id,
        target_user_id: user.id,
        prior_role: user.role,
      } as Prisma.InputJsonValue,
    },
  });
  return { ok: true };
}

function startOfUtcToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}
