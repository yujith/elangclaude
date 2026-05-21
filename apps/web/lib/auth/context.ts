// requireOrgContext — the single entry point every server component, server
// action, and route handler uses to authenticate the caller and obtain an
// OrgContext. The downstream code passes that ctx to `withOrg(ctx)` for
// every tenant-scoped query, per .claude/rules/multi-tenancy.md.
//
// Phase 1 implementation: reads our dev-only signed cookie. When Clerk
// lands, this file is the only place that changes — every callsite keeps
// the same `OrgContext` shape.

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { prisma } from "@elc/db/client";
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

/** Path to return to after dev login (set by middleware on protected routes). */
export async function devLoginReturnPath(fallback: string): Promise<string> {
  const h = await headers();
  return h.get("x-elc-pathname") ?? fallback;
}

const loadOrgContext = cache(async (): Promise<OrgContext> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) throw new UnauthenticatedError();

  const userId = verifySessionToken(token);
  if (!userId) throw new UnauthenticatedError();

  // Bootstrap lookup: cannot scope by org_id when we haven't yet derived it.
  // Trust the cookie's signed userId; the org comes from the row, not input.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      org_id: true,
      role: true,
      deleted_at: true,
      org: { select: { status: true } },
    },
  });
  if (!user) throw new UnauthenticatedError();

  // Soft-deleted users cannot resume a stale cookie. We surface the same
  // error as "not signed in" because the account no longer exists from
  // the customer's point of view — distinguishing it would just confirm
  // that the email used to be valid.
  if (user.deleted_at !== null) throw new UnauthenticatedError();

  // Suspended/Archived orgs lock out all roles except SuperAdmin (whose
  // job at that point is to un-suspend the org from /orgs).
  if (user.role !== "SuperAdmin" && user.org.status !== "Active") {
    throw new OrgSuspendedError(user.org.status);
  }

  return { org_id: user.org_id, user_id: user.id, role: user.role };
});

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
