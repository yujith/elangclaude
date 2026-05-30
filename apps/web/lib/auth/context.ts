// requireOrgContext — the single entry point every server component, server
// action, and route handler uses to authenticate the caller and obtain an
// OrgContext. The downstream code passes that ctx to `withOrg(ctx)` for
// every tenant-scoped query, per .claude/rules/multi-tenancy.md.
//
// Resolution order:
//   1. Clerk session (production + dev). User row matched by `clerk_user_id`
//      with a one-time email-based lazy link for seeded users who pre-date
//      their Clerk account.
//   2. Dev-only signed cookie (NODE_ENV !== "production" only). Lets the
//      /dev/login seeded-user switcher and the e2e suspend-gate test
//      continue to work without a Clerk session.
//
// Org-scoping reads `org_id` from the matched User row, never from Clerk's
// session claim — our DB stays the source of truth for org membership.

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@elc/db/client";
import { joinName } from "@elc/db";
import type { OrgContext, OrgStatus } from "@elc/db";
import type { Role } from "@elc/db";
import { SESSION_COOKIE, verifySessionToken } from "./dev-session";

export class UnauthenticatedError extends Error {
  readonly status = 401;
  constructor() {
    super("Not signed in.");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(
    public readonly requiredRole: Role,
    public readonly actualRole: Role,
  ) {
    super(`Role ${requiredRole} required, got ${actualRole}.`);
    this.name = "ForbiddenError";
  }
}

// Thrown when a non-SuperAdmin tries to load any context while their org
// is Suspended or Archived. SuperAdmins bypass this gate because their
// only job at that point is to un-suspend the org.
export class OrgSuspendedError extends Error {
  readonly status = 403;
  constructor(public readonly orgStatus: OrgStatus) {
    super(`Organisation is ${orgStatus}.`);
    this.name = "OrgSuspendedError";
  }
}

// Thrown when a Clerk session is valid but the signed-in user is not on
// any org's roster (no DB row by email, or the row was soft-deleted).
// Distinct from UnauthenticatedError so caller-side redirects can send
// these users to /no-access instead of /sign-in — looping them back
// through Clerk would just sign them in again and re-throw.
export class NoOrgMembershipError extends Error {
  readonly status = 403;
  constructor() {
    super("Signed in, but not on any organisation roster.");
    this.name = "NoOrgMembershipError";
  }
}

/** Path to return to after sign-in (set by middleware on protected routes). */
export async function devLoginReturnPath(fallback: string): Promise<string> {
  const h = await headers();
  return h.get("x-elc-pathname") ?? fallback;
}

const userSelect = {
  id: true,
  org_id: true,
  role: true,
  deleted_at: true,
  org: { select: { status: true } },
} as const;

type MatchedUser = {
  id: string;
  org_id: string;
  role: Role;
  deleted_at: Date | null;
  org: { status: OrgStatus };
};

const loadOrgContext = cache(async (): Promise<OrgContext> => {
  // 1. Try Clerk first. Works in both production and dev.
  const { userId: clerkUserId, orgId: clerkOrgId } = await auth();
  if (clerkUserId) {
    const user = await loadUserForClerkId(clerkUserId, clerkOrgId ?? null);
    // A linked user can later be soft-deleted by an admin. Distinguish
    // that from "no Clerk session at all" so the caller can route to
    // /no-access instead of bouncing back through /sign-in.
    if (user.deleted_at !== null) throw new NoOrgMembershipError();
    return assertActiveAndReturn(user);
  }

  // 2. Dev fallback — signed cookie set by /dev/login. Never trusted in
  // production: even if a cookie made it onto the wire we refuse to read it.
  if (process.env.NODE_ENV !== "production") {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!token) throw new UnauthenticatedError();

    const userId = verifySessionToken(token);
    if (!userId) throw new UnauthenticatedError();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: userSelect,
    });
    if (!user) throw new UnauthenticatedError();
    if (user.deleted_at !== null) throw new UnauthenticatedError();
    return assertActiveAndReturn(user);
  }

  throw new UnauthenticatedError();
});

async function loadUserForClerkId(
  clerkUserId: string,
  clerkOrgId: string | null,
): Promise<MatchedUser> {
  // ── Org-scoped fast path (OrgAdmin with active Clerk org) ────────────
  if (clerkOrgId) {
    const dbOrg = await prisma.organization.findUnique({
      where: { clerk_org_id: clerkOrgId },
      select: { id: true },
    });
    if (dbOrg) {
      const linked = await prisma.user.findFirst({
        where: { clerk_user_id: clerkUserId, org_id: dbOrg.id },
        select: userSelect,
      });
      if (linked) return linked;

      // Org-scoped lazy-link for seeded OrgAdmins
      const clerkUser = await currentUser();
      const email = primaryEmail(clerkUser);
      if (email) {
        const byEmail = await prisma.user.findFirst({
          where: { email, org_id: dbOrg.id },
          select: userSelect,
        });
        if (byEmail && byEmail.deleted_at === null) {
          const clerkName = joinName(
            clerkUser?.firstName ?? null,
            clerkUser?.lastName ?? null,
          );
          await prisma.user.update({
            where: { id: byEmail.id },
            data: {
              clerk_user_id: clerkUserId,
              ...(clerkName ? { name: clerkName } : {}),
            },
          });
          return byEmail;
        }
      }
      throw new NoOrgMembershipError();
    }
  }

  // ── No active Clerk org (Learner path, or multi-org user needs to pick) ──
  const allLinked = await prisma.user.findMany({
    where: { clerk_user_id: clerkUserId, deleted_at: null },
    select: userSelect,
  });
  if (allLinked.length === 1) return allLinked[0];
  if (allLinked.length > 1) redirect("/select-org");

  // ── Lazy-link: seeded user signing in for the first time ─────────────
  const clerkUser = await currentUser();
  const email = primaryEmail(clerkUser);
  if (!email) throw new NoOrgMembershipError();

  const allByEmail = await prisma.user.findMany({
    where: { email, deleted_at: null },
    select: userSelect,
  });
  if (allByEmail.length === 1) {
    const clerkName = joinName(
      clerkUser?.firstName ?? null,
      clerkUser?.lastName ?? null,
    );
    await prisma.user.update({
      where: { id: allByEmail[0].id },
      data: {
        clerk_user_id: clerkUserId,
        ...(clerkName ? { name: clerkName } : {}),
      },
    });
    return allByEmail[0];
  }
  if (allByEmail.length > 1) redirect("/select-org");

  throw new NoOrgMembershipError();
}

function primaryEmail(
  clerkUser: Awaited<ReturnType<typeof currentUser>>,
): string | null {
  if (!clerkUser) return null;
  const primaryId = clerkUser.primaryEmailAddressId;
  const primary = clerkUser.emailAddresses.find((e) => e.id === primaryId);
  const raw = primary?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;
  return raw ? raw.trim().toLowerCase() : null;
}

function assertActiveAndReturn(user: MatchedUser): OrgContext {
  // Callers must check `deleted_at` themselves — the right error class
  // differs between the Clerk path (NoOrgMembershipError → /no-access)
  // and the dev-session path (UnauthenticatedError → /sign-in).

  // Suspended/Archived orgs lock out all roles except SuperAdmin (whose
  // job at that point is to un-suspend the org from /orgs).
  if (user.role !== "SuperAdmin" && user.org.status !== "Active") {
    throw new OrgSuspendedError(user.org.status);
  }

  return { org_id: user.org_id, user_id: user.id, role: user.role };
}

export async function requireOrgContext(): Promise<OrgContext> {
  return loadOrgContext();
}

export async function requireRole(role: Role): Promise<OrgContext> {
  const ctx = await requireOrgContext();
  if (ctx.role !== role) throw new ForbiddenError(role, ctx.role);
  return ctx;
}

export async function tryGetOrgContext(): Promise<OrgContext | null> {
  try {
    return await requireOrgContext();
  } catch {
    return null;
  }
}
