// Role-agnostic dashboard entry point. Any signed-in user can hit /dashboard
// (it's the "Dashboard" link in the marketing header, and a stable bookmarkable
// URL) and we redirect them to their role-specific home via resolveRoleHome.
//
// Unlike /post-signin, this is reached by an ordinary navigation (a header
// <Link> click, not Clerk's soft-nav into the trampoline), so a plain Server
// Component redirect() fires reliably — no client-side redirector needed.
//
// Errors mirror the /post-signin contract:
//   UnauthenticatedError  → /sign-in
//   NoOrgMembershipError  → /no-access
//   OrgSuspendedError     → /suspended

import { redirect } from "next/navigation";
import {
  NoOrgMembershipError,
  OrgSuspendedError,
  UnauthenticatedError,
  requireOrgContext,
} from "@/lib/auth/context";
import { resolveRoleHome } from "@/lib/auth/role-home";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
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

  redirect(await resolveRoleHome(ctx));
}
