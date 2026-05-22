// Post-signin trampoline. Clerk's <SignIn> / <SignUp> redirect here after
// a successful authentication; we load the OrgContext, check the role,
// and send the user to their actual home. Clerk's `fallbackRedirectUrl`
// is static, so without this every role would land on the same page.
//
// Errors:
//   - UnauthenticatedError  → /sign-in (the lazy-link couldn't match the
//                              Clerk user to a DB row — they're not on
//                              any org's roster yet). Phase 2 will swap
//                              this for /no-access with a clear message.
//   - OrgSuspendedError     → /suspended (existing pattern).

import { redirect } from "next/navigation";
import {
  NoOrgMembershipError,
  OrgSuspendedError,
  UnauthenticatedError,
  requireOrgContext,
} from "@/lib/auth/context";

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

  switch (ctx.role) {
    case "SuperAdmin":
      redirect("/orgs");
    case "OrgAdmin":
      redirect("/admin");
    case "Learner":
    default:
      redirect("/practice/writing");
  }
}
