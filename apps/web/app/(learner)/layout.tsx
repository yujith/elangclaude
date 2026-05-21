import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { devLogout } from "../dev/login/actions";
import {
  OrgSuspendedError,
  UnauthenticatedError,
  devLoginReturnPath,
  requireOrgContext,
} from "@/lib/auth/context";
import { prisma } from "@elc/db/client";

export const dynamic = "force-dynamic";

export default async function LearnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let ctx;
  try {
    ctx = await requireOrgContext();
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      const to = await devLoginReturnPath("/practice/writing");
      redirect(`/dev/login?to=${encodeURIComponent(to)}`);
    }
    if (err instanceof OrgSuspendedError) {
      redirect(`/suspended?status=${err.orgStatus}`);
    }
    throw err;
  }

  // Load name + track for the header. This is one extra query per page —
  // acceptable for v1; cache later if it becomes hot.
  const user = await prisma.user.findUnique({
    where: { id: ctx.user_id },
    select: { name: true, email: true, ielts_track: true, org: { select: { name: true } } },
  });

  return (
    <div className="min-h-screen flex flex-col bg-brand-grey-50">
      <header className="bg-brand-black text-white">
        <div className="mx-auto max-w-7xl px-6 py-3 flex items-center justify-between gap-4">
          <Link
            href="/practice/writing"
            className="flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm"
          >
            <Logo variant="on-dark" height={35} />
          </Link>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="font-heading font-bold text-sm leading-tight">
                {user?.name ?? user?.email ?? "Learner"}
              </p>
              <p className="font-body text-xs text-brand-grey-200 leading-tight">
                {user?.org.name} · {user?.ielts_track === "Academic" ? "Academic" : "General Training"}
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
