import Link from "next/link";
import { redirect } from "next/navigation";
import { LearnerNav } from "@/components/learner-nav";
import { Logo } from "@/components/logo";
import { OrgThemeAssets } from "@/components/org-theme-assets";
import { SignOutControl } from "@/components/sign-out-control";
import {
  NoOrgMembershipError,
  OrgSuspendedError,
  UnauthenticatedError,
  devLoginReturnPath,
  requireOrgContext,
} from "@/lib/auth/context";
import { getOrgTheme, orgThemeStyle } from "@/lib/branding/org-theme";

const SIGN_IN_PATH = "/sign-in";

export const dynamic = "force-dynamic";

export default async function LearnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireOrgContext();
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      const to = await devLoginReturnPath("/home");
      redirect(`${SIGN_IN_PATH}?to=${encodeURIComponent(to)}`);
    }
    if (err instanceof NoOrgMembershipError) redirect("/no-access");
    if (err instanceof OrgSuspendedError) {
      redirect(`/suspended?status=${err.orgStatus}`);
    }
    throw err;
  }

  // Org custom branding (ADR-0023): CSS-var override scoped to this frame —
  // never :root — so public/marketing surfaces stay platform-branded.
  const theme = await getOrgTheme();

  return (
    <div
      className="min-h-screen flex flex-col bg-brand-grey-50"
      style={orgThemeStyle(theme)}
    >
      <OrgThemeAssets theme={theme} />
      <header className="bg-brand-black text-white">
        <div className="mx-auto max-w-7xl px-6 py-3 flex items-center justify-between gap-4">
          <Link
            href="/home"
            className="flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm"
          >
            <Logo variant="on-dark" height={40} />
            <span className="font-body text-xs uppercase tracking-widest text-brand-grey-200">
              Learner
            </span>
          </Link>
          <div className="flex items-center gap-6">
            <LearnerNav />
            <SignOutControl />
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
