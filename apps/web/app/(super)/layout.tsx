import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import {
  ForbiddenError,
  UnauthenticatedError,
  requireRole,
} from "@/lib/auth/context";
import { devLogout } from "../dev/login/actions";

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
      redirect("/dev/login?to=/content/reading");
    }
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
            href="/content/reading"
            className="flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm"
          >
            <Logo variant="on-dark" height={28} />
            <span className="font-body text-xs uppercase tracking-widest text-brand-grey-200">
              SuperAdmin
            </span>
          </Link>
          <nav className="flex items-center gap-6">
            <Link
              href="/content/reading"
              className="font-heading font-bold text-sm text-white hover:text-brand-red transition-colors"
            >
              Reading content
            </Link>
            <Link
              href="/content/writing"
              className="font-heading font-bold text-sm text-white hover:text-brand-red transition-colors"
            >
              Writing content
            </Link>
            <form action={devLogout}>
              <button
                type="submit"
                className="font-body font-medium text-sm text-brand-grey-200 hover:text-white underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm"
              >
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
