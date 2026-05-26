import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { SignOutControl } from "@/components/sign-out-control";
import {
  ForbiddenError,
  NoOrgMembershipError,
  UnauthenticatedError,
  devLoginReturnPath,
  requireRole,
} from "@/lib/auth/context";

const SIGN_IN_PATH = "/sign-in";

export const dynamic = "force-dynamic";

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireRole("SuperAdmin");
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      const to = await devLoginReturnPath("/orgs");
      redirect(`${SIGN_IN_PATH}?to=${encodeURIComponent(to)}`);
    }
    if (err instanceof NoOrgMembershipError) redirect("/no-access");
    if (err instanceof ForbiddenError) {
      // A signed-in non-SuperAdmin lands here — bounce them to their
      // expected surface rather than rendering the console.
      redirect("/practice/reading");
    }
    throw err;
  }

  return (
    <div className="min-h-screen flex flex-col bg-brand-grey-50">
      <header className="bg-brand-black text-white">
        <div className="mx-auto max-w-7xl px-6 py-3 flex items-center justify-between gap-4">
          <Link
            href="/orgs"
            className="flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm"
          >
            <Logo variant="on-dark" height={40} />
            <span className="font-body text-xs uppercase tracking-widest text-brand-grey-200">
              SuperAdmin
            </span>
          </Link>
          <nav className="flex items-center gap-6">
            <Link
              href="/orgs"
              className="font-heading font-bold text-sm text-white hover:text-brand-red transition-colors"
            >
              Orgs
            </Link>
            <Link
              href="/plans"
              className="font-heading font-bold text-sm text-white hover:text-brand-red transition-colors"
            >
              Plans
            </Link>
            <Link
              href="/users"
              className="font-heading font-bold text-sm text-white hover:text-brand-red transition-colors"
            >
              Users
            </Link>
            <Link
              href="/metrics"
              className="font-heading font-bold text-sm text-white hover:text-brand-red transition-colors"
            >
              Metrics
            </Link>
            <Link
              href="/content"
              className="font-heading font-bold text-sm text-white hover:text-brand-red transition-colors"
            >
              Content
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
