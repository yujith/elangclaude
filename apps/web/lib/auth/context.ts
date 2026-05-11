// requireOrgContext — the single entry point every server component, server
// action, and route handler uses to authenticate the caller and obtain an
// OrgContext. The downstream code passes that ctx to `withOrg(ctx)` for
// every tenant-scoped query, per .claude/rules/multi-tenancy.md.
//
// Phase 1 implementation: reads our dev-only signed cookie. When Clerk
// lands, this file is the only place that changes — every callsite keeps
// the same `OrgContext` shape.

import { cookies } from "next/headers";
import { prisma } from "@elc/db/client";
import type { OrgContext } from "@elc/db";
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

export async function requireOrgContext(): Promise<OrgContext> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) throw new UnauthenticatedError();

  const userId = verifySessionToken(token);
  if (!userId) throw new UnauthenticatedError();

  // Bootstrap lookup: cannot scope by org_id when we haven't yet derived it.
  // Trust the cookie's signed userId; the org comes from the row, not input.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, org_id: true, role: true },
  });
  if (!user) throw new UnauthenticatedError();

  return { org_id: user.org_id, user_id: user.id, role: user.role };
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
