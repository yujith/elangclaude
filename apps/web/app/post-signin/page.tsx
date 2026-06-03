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
import { resolveRoleHome } from "@/lib/auth/role-home";
import { ensureConsentRecorded } from "@elc/db";
import { termsPrivacyVersion } from "@/lib/legal/policies";
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

  // Capture Terms + Privacy acceptance once per version (account creation
  // implies acceptance — the sign-up form states this and links both docs).
  // Best-effort: a consent-ledger hiccup must never block sign-in.
  try {
    await ensureConsentRecorded(ctx, {
      consent_type: "terms_privacy",
      policy_version: termsPrivacyVersion(),
      source: "signup",
    });
  } catch {
    // swallow — routing continues regardless
  }

  // Role-specific home — shared with the /dashboard entry point. OrgAdmins
  // whose Org hasn't completed Checkout yet (ADR-0017 Phase 5) land on the
  // onboarding wizard instead of /admin; Learners/SuperAdmin are unaffected.
  const target = await resolveRoleHome(ctx);

  return <PostSigninRedirector to={target} />;
}
