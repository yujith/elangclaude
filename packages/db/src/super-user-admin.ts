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

import { createClerkClient } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import { Prisma, type Role } from "@prisma/client";
import { buildClerkInvitationRedirectUrl } from "./clerk-invite-url";
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
  | "org_mismatch"
  // ─── ADR-0017 Phase 3 — Clerk invitation failure paths ──────────────
  // Org has no clerk_org_id stamped; the invite path needs one because
  // org-level Clerk invitations target a specific organisation.
  | "org_has_no_clerk_org"
  // SuperAdmin's User row has no clerk_user_id — they must sign in via
  // Clerk at least once before inviting (lazy-link stamps the id).
  | "inviter_clerk_id_missing"
  // Two consecutive 429s from Clerk — surface so SuperAdmin can retry.
  | "clerk_rate_limited";

export type InviteOrgAdminResult =
  | { ok: true; user_id: string; alreadyExisted: boolean }
  | { ok: false; reason: SuperUserFailureReason };

export type SuperUserResult =
  | { ok: true }
  | { ok: false; reason: SuperUserFailureReason };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ASSIGNABLE_ROLES: ReadonlySet<Role> = new Set<Role>(["OrgAdmin", "Learner"]);
const CLERK_RETRY_DELAY_MS = 2000;

// Narrow surface of the Clerk SDK used for OrgAdmin invitations. Same
// injection pattern as admin-invite.ts — letting tests pass a stub
// keeps vi.mock("@clerk/backend") out of the picture.
export interface OrgAdminInviteClerkClient {
  organizations: {
    createOrganizationInvitation(params: {
      organizationId: string;
      emailAddress: string;
      inviterUserId: string;
      role: string;
      redirectUrl?: string;
      publicMetadata?: Record<string, unknown>;
    }): Promise<{ id: string }>;
  };
}

export interface OrgAdminInviteOptions {
  /** Test-only injection. Production omits and we build from env. */
  clerkClient?: OrgAdminInviteClerkClient;
  /** Test-only override. Production invite links always use the canonical
   *  public domain, even if APP_URL is accidentally set to localhost. */
  appUrl?: string;
  /** Test-only — replace setTimeout for the 429-retry path. */
  sleep?: (ms: number) => Promise<void>;
  /** Opt out of the Clerk-side invitation entirely. Defaults to false.
   *  Used by the legacy /orgs/[orgId]/users path (which only writes the
   *  DB row and does not send an email — covered by separate flows). */
  skipClerkInvitation?: boolean;
}

export class OrgAdminInviteEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrgAdminInviteEnvError";
  }
}

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
  options: OrgAdminInviteOptions = {},
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
    select: { id: true, clerk_org_id: true, billing_owner_user_id: true },
  });
  if (!org) return { ok: false, reason: "org_not_found" };

  // Within-org duplicate check only. Cross-org invites are allowed (ADR-0018).
  const existing = await db.user.findFirst({
    where: { email, org_id: input.org_id },
    select: { id: true, role: true, deleted_at: true },
  });
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
    await maybeStampBillingOwner(input.org_id, existing.id);
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

  // ── ADR-0017 Phase 3: send Clerk Organization Invitation ───────────
  // The DB row is in place; now hand the email to Clerk. On hard
  // failure (5xx / second 429), undo the DB row so the next attempt
  // starts clean and the admin UI doesn't show an orphan OrgAdmin.
  if (!options.skipClerkInvitation) {
    const inviteResult = await sendOrgAdminInvitation({
      org: { id: org.id, clerk_org_id: org.clerk_org_id },
      inviter_user_id: ctx.user_id,
      email,
      options,
    });
    if (inviteResult.kind === "fail") {
      await prisma.user.delete({ where: { id: created.id } });
      return { ok: false, reason: inviteResult.reason };
    }
  }

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
  await maybeStampBillingOwner(input.org_id, created.id);
  return { ok: true, user_id: created.id, alreadyExisted: false };
}

// Stamp billing_owner_user_id on the Org if it isn't already set. The
// first OrgAdmin invited for an Org becomes its billing owner per
// ADR-0017 D9. Subsequent invites preserve the original owner.
async function maybeStampBillingOwner(
  orgId: string,
  userId: string,
): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId, billing_owner_user_id: null },
    data: { billing_owner_user_id: userId },
  }).catch((err) => {
    // P2025 = "Record not found" — happens when billing_owner_user_id
    // is already set (the WHERE clause filters it out). That's the
    // expected idempotent no-op.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      return;
    }
    throw err;
  });
}

// ─── Clerk-side invitation ──────────────────────────────────────────────

type SendOrgAdminInvitationResult =
  | { kind: "ok" }
  | {
      kind: "fail";
      reason: "cannot_invite" | "clerk_rate_limited" | "org_has_no_clerk_org";
    };

async function sendOrgAdminInvitation(args: {
  org: { id: string; clerk_org_id: string | null };
  inviter_user_id: string;
  email: string;
  options: OrgAdminInviteOptions;
}): Promise<SendOrgAdminInvitationResult> {
  const { org, inviter_user_id, email, options } = args;
  if (!org.clerk_org_id) {
    return { kind: "fail", reason: "org_has_no_clerk_org" };
  }

  // The inviter (SuperAdmin) must have a clerk_user_id stamped — we
  // pass it to Clerk as the inviting user. SuperAdmin gets one the
  // first time they sign in via Clerk (lazy-link); seeded SuperAdmins
  // get one from clerk-seed.ts.
  const inviter = await prisma.user.findUnique({
    where: { id: inviter_user_id },
    select: { clerk_user_id: true },
  });
  if (!inviter?.clerk_user_id) {
    return { kind: "fail", reason: "cannot_invite" };
  }

  const client = options.clerkClient ?? buildOrgInviteClerkClient();
  const sleep = options.sleep ?? defaultSleep;

  // Land on /sign-up so Clerk's <SignUp> can read __clerk_ticket and
  // bind the new account to the org invitation. After sign-up the
  // /post-signin trampoline routes to /onboarding/plan if the Org is
  // still PendingPayment.
  const params = {
    organizationId: org.clerk_org_id,
    emailAddress: email,
    inviterUserId: inviter.clerk_user_id,
    role: "org:admin",
    redirectUrl: buildClerkInvitationRedirectUrl(
      options.appUrl ?? process.env.APP_URL,
      { allowCustomBaseUrl: Boolean(options.appUrl) },
    ),
    publicMetadata: { org_id: org.id, role: "OrgAdmin" } as Record<
      string,
      unknown
    >,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await client.organizations.createOrganizationInvitation(params);
      return { kind: "ok" };
    } catch (err) {
      if (isDuplicateInvitation(err)) {
        // Already invited / already a member — idempotent success.
        return { kind: "ok" };
      }
      if (isRateLimited(err)) {
        if (attempt === 0) {
          await sleep(CLERK_RETRY_DELAY_MS);
          continue;
        }
        return { kind: "fail", reason: "clerk_rate_limited" };
      }
      if (isServerError(err)) {
        return { kind: "fail", reason: "cannot_invite" };
      }
      // 4xx other than duplicate / 429 is a config error — surface so
      // the admin sees a 500 and we get a Sentry hit instead of a
      // silent failure.
      throw err;
    }
  }
  return { kind: "fail", reason: "cannot_invite" };
}

function buildOrgInviteClerkClient(): OrgAdminInviteClerkClient {
  if (!process.env.CLERK_SECRET_KEY) {
    throw new OrgAdminInviteEnvError(
      "CLERK_SECRET_KEY must be set to send Clerk organisation invitations. " +
        "Pass options.clerkClient in tests, or set the env var in " +
        "packages/db/.env (dev) / Vercel project settings (prod).",
    );
  }
  return createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
  }) as unknown as OrgAdminInviteClerkClient;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDuplicateInvitation(err: unknown): boolean {
  if (!isClerkAPIResponseError(err)) return false;
  return err.errors.some((e: { code: string }) =>
    [
      "duplicate_record",
      "already_a_member_in_organization",
      "organization_invitation_already_pending",
    ].includes(e.code),
  );
}

function isRateLimited(err: unknown): boolean {
  if (!isClerkAPIResponseError(err)) return false;
  return err.status === 429;
}

function isServerError(err: unknown): boolean {
  if (!isClerkAPIResponseError(err)) return false;
  return err.status >= 500 && err.status < 600;
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
