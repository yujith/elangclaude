import { prisma } from "@elc/db/client";
import type { OrgContext } from "@elc/db";

// Single source of truth for "where does this signed-in user's dashboard live?"
// Shared by the /post-signin trampoline (post-auth) and the /dashboard route
// (the role-agnostic entry point linked from the marketing header). Keep the
// two callers in lockstep by routing both through here.
//
//   SuperAdmin → /orgs (cross-org console)
//   OrgAdmin   → /admin, or /onboarding/plan while the Org hasn't finished
//                Stripe Checkout yet (ADR-0017 Phase 5 PendingPayment gate)
//   Learner    → /home (ADR-0015 learner home dashboard)
export async function resolveRoleHome(ctx: OrgContext): Promise<string> {
  if (ctx.role === "SuperAdmin") return "/orgs";

  if (ctx.role === "OrgAdmin") {
    const org = await prisma.organization.findUnique({
      where: { id: ctx.org_id },
      select: { subscription_status: true },
    });
    return org?.subscription_status === "PendingPayment"
      ? "/onboarding/plan"
      : "/admin";
  }

  return "/home";
}
