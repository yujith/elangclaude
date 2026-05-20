import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import {
  ForbiddenError,
  UnauthenticatedError,
  devLoginReturnPath,
  requireRole,
} from "@/lib/auth/context";
import { withOrg } from "@elc/db";
import { devLogout } from "../dev/login/actions";

export const dynamic = "force-dynamic";

export default async function OrgAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let ctx;
  try {
    ctx = await requireRole("OrgAdmin");
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      const to = await devLoginReturnPath("/admin");
      redirect(`/dev/login?to=${encodeURIComponent(to)}`);
    }
    if (err instanceof ForbiddenError) {
      // Bounce non-OrgAdmins to their expected surface rather than
      // leaking the existence of this console.
      if (err.actualRole === "SuperAdmin") redirect("/content/reading");
      redirect("/practice/reading");
    }
    throw err;
  }

  const user = await withOrg(ctx).user.findUnique({
    where: { id: ctx.user_id },
    select: { name: true, email: true, org: { select: { name: true } } },
  });

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
              href="/admin/activity"
              className="font-heading font-bold text-sm text-white hover:text-brand-red transition-colors"
            >
              Activity
            </Link>
          </nav>
          <div className="flex items-center gap-6">
            <div className="text-right hidden sm:block">
              <p className="font-heading font-bold text-sm leading-tight">
                {user?.name ?? user?.email ?? "Admin"}
              </p>
              <p className="font-body text-xs text-brand-grey-200 leading-tight">
                {user?.org.name}
              </p>
            </div>
            <form action={devLogout}>
              <button
                type="submit"
                className="font-body font-medium text-sm text-brand-grey-200 hover:text-white underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
