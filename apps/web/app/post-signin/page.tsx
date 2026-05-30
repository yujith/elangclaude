// Post-signin trampoline. Clerk's <SignIn> / <SignUp> redirect here after
// a successful authentication; we load the OrgContext on the server, decide
// the role-specific home, then hand the URL to a client-side redirector so
// the navigation happens inside Clerk's client router context (Server-
// Component `redirect()` doesn't reliably fire after Clerk's soft nav into
// /post-signin on Next 16 — the user gets stuck until they hard-refresh).
//
// Errors:
//   - UnauthenticatedError  → /sign-in (no Clerk session somehow)
//   - NoOrgMembershipError  → /no-access (Clerk user not on any DB roster)
//   - OrgSuspendedError     → /suspended (existing pattern)

import { redirect } from "next/navigation";
import { prisma } from "@elc/db/client";
import {
  NoOrgMembershipError,
  OrgSuspendedError,
  UnauthenticatedError,
  requireOrgContext,
} from "@/lib/auth/context";
import { PostSigninRedirector } from "./post-signin-redirector";

export const dynamic = "force-dynamic";

export default async function PostSigninPage() {
  let ctx;
  try {
    ctx = await requireOrgContext();
  } catch (err) {
    if (err instanceof UnauthenticatedError) redirect("/sign-in");
    if (err instanceof NoOrgMembershipError) redirect("/no-access");
    if (err instanceof OrgSuspendedError) {
      redirect(`/suspended?status=${err.orgStatus}`);
    }
    throw err;
  }

  // OrgAdmins whose Org hasn't completed Checkout yet (ADR-0017 Phase 5)
  // land on the onboarding wizard instead of /admin. SuperAdmin and
  // Learner routing is unaffected — Learners are single-org and never
  // see PendingPayment, SuperAdmin's billing state is irrelevant to
  // their cross-org tooling.
  let target: string;
  if (ctx.role === "SuperAdmin") {
    target = "/orgs";
  } else if (ctx.role === "OrgAdmin") {
    const org = await prisma.organization.findUnique({
      where: { id: ctx.org_id },
      select: { subscription_status: true },
    });
    target =
      org?.subscription_status === "PendingPayment"
        ? "/onboarding/plan"
        : "/admin";
  } else {
    target = "/home";
  }

  return <PostSigninRedirector to={target} />;
}
