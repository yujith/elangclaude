import Link from "next/link";
import { redirect } from "next/navigation";
import { LearnerNav } from "@/components/learner-nav";
import { Logo } from "@/components/logo";
import { SignOutControl } from "@/components/sign-out-control";
import {
  NoOrgMembershipError,
  OrgSuspendedError,
  UnauthenticatedError,
  devLoginReturnPath,
  requireOrgContext,
} from "@/lib/auth/context";
import { prisma } from "@elc/db/client";

const SIGN_IN_PATH = "/sign-in";

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
      const to = await devLoginReturnPath("/home");
      redirect(`${SIGN_IN_PATH}?to=${encodeURIComponent(to)}`);
    }
    if (err instanceof NoOrgMembershipError) redirect("/no-access");
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
        <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <Link
            href="/home"
            className="flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm"
          >
            <Logo variant="on-dark" height={40} />
            <span className="font-body text-xs uppercase tracking-widest text-brand-grey-200">
              Learner
            </span>
          </Link>
          <LearnerNav className="absolute left-1/2 hidden -translate-x-1/2 lg:block" />
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="font-heading font-bold text-sm leading-tight">
                {user?.name ?? user?.email ?? "Learner"}
              </p>
              <p className="font-body text-xs text-brand-grey-200 leading-tight">
                {user?.org.name} · {user?.ielts_track === "Academic" ? "Academic" : "General Training"}
              </p>
            </div>
            <SignOutControl />
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
