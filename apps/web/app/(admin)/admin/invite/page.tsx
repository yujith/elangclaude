import type { Metadata } from "next";
import Link from "next/link";
import { withOrg } from "@elc/db";
import { prisma } from "@elc/db/client";
import { InvitePanel } from "@/components/admin/invite-panel";
import { requireRole } from "@/lib/auth/context";

export const metadata: Metadata = {
  title: "Org admin · Invite learners",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function OrgAdminInvitePage() {
  const ctx = await requireRole("OrgAdmin");
  const db = withOrg(ctx);

  const [org, learnerCountAll] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: ctx.org_id },
      select: { seat_limit: true },
    }),
    db.user.count({ where: { role: "Learner" } }),
  ]);

  const seatLimit = org?.seat_limit ?? 0;
  const remaining = Math.max(0, seatLimit - learnerCountAll);

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-body text-sm uppercase tracking-widest text-brand-red">
              Org admin
            </p>
            <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
              Invite learners.
            </h1>
            <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
              Add learners by single email or bulk CSV. Successful invites stay
              here so you can keep building the roster.
            </p>
            {seatLimit > 0 ? (
              <p className="mt-2 font-body text-sm text-brand-grey-600 max-w-2xl">
                {remaining} of {seatLimit} seats remaining. Removed learners
                still reserve seats in this phase.
              </p>
            ) : (
              <p className="mt-2 font-body text-sm text-brand-grey-600 max-w-2xl">
                Your organisation has no seat limit configured. Contact support
                if that&apos;s unexpected.
              </p>
            )}
          </div>
          <Link
            href="/admin/learners"
            className="inline-flex items-center rounded-pill border border-brand-grey-300 bg-brand-white px-4 py-2 font-heading font-bold text-sm text-brand-black hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 transition-colors"
          >
            View roster
          </Link>
        </header>

        <InvitePanel />
      </div>
    </section>
  );
}
