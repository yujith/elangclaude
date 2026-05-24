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

  const target =
    ctx.role === "SuperAdmin"
      ? "/orgs"
      : ctx.role === "OrgAdmin"
        ? "/admin"
        : "/practice/writing";

  return <PostSigninRedirector to={target} />;
}
