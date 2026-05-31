import Link from "next/link";
import { redirect } from "next/navigation";
import { OrganizationSwitcher } from "@clerk/nextjs";
import { Logo } from "@/components/logo";
import { SignOutControl } from "@/components/sign-out-control";
import {
  ForbiddenError,
  NoOrgMembershipError,
  OrgSuspendedError,
  UnauthenticatedError,
  devLoginReturnPath,
  requireRole,
} from "@/lib/auth/context";

const SIGN_IN_PATH = "/sign-in";

export const dynamic = "force-dynamic";

export default async function OrgAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireRole("OrgAdmin");
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      const to = await devLoginReturnPath("/admin");
      redirect(`${SIGN_IN_PATH}?to=${encodeURIComponent(to)}`);
    }
    if (err instanceof NoOrgMembershipError) redirect("/no-access");
    if (err instanceof OrgSuspendedError) {
      redirect(`/suspended?status=${err.orgStatus}`);
    }
    if (err instanceof ForbiddenError) {
      // Bounce non-OrgAdmins to their expected surface rather than
      // leaking the existence of this console.
      if (err.actualRole === "SuperAdmin") redirect("/orgs");
      redirect("/practice/reading");
    }
    throw err;
  }

  // Multi-org (ADR-0018): when enabled, one Clerk identity can hold User
  // rows in several orgs. Surface Clerk's <OrganizationSwitcher> so an
  // OrgAdmin can flip the active org (which drives DB-user resolution in
  // requireOrgContext). Hidden while the flag is off — Learners and
  // single-org admins keep the existing chrome unchanged.
  const multiOrg = process.env.MULTI_ORG_ENABLED === "1";

  return (
    <div className="min-h-screen flex flex-col bg-brand-grey-50">
      <header className="bg-brand-black text-white">
        <div className="mx-auto max-w-7xl px-6 py-3 flex items-center justify-between gap-4">
          <Link
            href="/admin"
            className="flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm"
          >
            <Logo variant="on-dark" height={40} />
            <span className="font-body text-xs uppercase tracking-widest text-brand-grey-200">
              Org admin
            </span>
          </Link>
          <nav className="flex items-center gap-6">
            {multiOrg && (
              <OrganizationSwitcher
                hidePersonal
                afterSelectOrganizationUrl="/post-signin"
                afterLeaveOrganizationUrl="/post-signin"
                appearance={{
                  variables: { colorPrimary: "#EE2346" },
                  elements: {
                    // Org creation must run through /signup-org or /orgs/new
                    // so it lands on a Plan + billing — hide the in-switcher
                    // "Create organization" action to prevent a billing bypass.
                    organizationSwitcherPopoverActionButton__createOrganization:
                      { display: "none" },
                  },
                }}
              />
            )}
            <Link
              href="/admin"
              className="font-heading font-bold text-sm text-white hover:text-brand-red transition-colors"
            >
              Overview
            </Link>
            <Link
              href="/admin/learners"
              className="font-heading font-bold text-sm text-white hover:text-brand-red transition-colors"
            >
              Learners
            </Link>
            <Link
              href="/admin/invite"
              className="font-heading font-bold text-sm text-white hover:text-brand-red transition-colors"
            >
              Invite
            </Link>
            <Link
              href="/admin/activity"
              className="font-heading font-bold text-sm text-white hover:text-brand-red transition-colors"
            >
              Activity
            </Link>
            <Link
              href="/admin/billing"
              className="font-heading font-bold text-sm text-white hover:text-brand-red transition-colors"
            >
              Billing
            </Link>
            <Link
              href="/profile"
              className="font-heading font-bold text-sm text-white hover:text-brand-red transition-colors"
            >
              Profile
            </Link>
            <SignOutControl />
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
