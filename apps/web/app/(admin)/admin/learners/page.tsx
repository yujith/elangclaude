import type { Metadata } from "next";
import { withOrg } from "@elc/db";
import { prisma } from "@elc/db/client";
import { requireRole } from "@/lib/auth/context";
import { InvitePanel } from "@/components/admin/invite-panel";

export const metadata: Metadata = {
  title: "Org admin · Learners",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function OrgAdminLearnersPage() {
  const ctx = await requireRole("OrgAdmin");
  const db = withOrg(ctx);

  const [org, learners, learnerCount] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: ctx.org_id },
      select: { seat_limit: true },
    }),
    db.user.findMany({
      where: { role: "Learner" },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      select: {
        id: true,
        email: true,
        name: true,
        ielts_track: true,
        createdAt: true,
      },
    }),
    db.user.count({ where: { role: "Learner" } }),
  ]);

  const seatLimit = org?.seat_limit ?? 0;
  const remaining = Math.max(0, seatLimit - learnerCount);

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl space-y-10">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Org admin
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Learners.
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
            {seatLimit === 0
              ? "Your organisation has no seat limit configured. Contact support if that's unexpected."
              : `You have ${remaining} of ${seatLimit} seats remaining.`}
          </p>
        </header>

        <InvitePanel />

        <div>
          <h2 className="font-heading font-bold text-xl text-brand-black">
            Roster
          </h2>
          <p className="mt-1 font-body text-sm text-brand-grey-700">
            Showing the {Math.min(learnerCount, PAGE_SIZE)} most recently
            added learners.
          </p>
          <div className="mt-4 rounded-lg bg-brand-white ring-1 ring-brand-grey-200 overflow-hidden">
            {learners.length === 0 ? (
              <p className="px-6 py-8 font-body text-base text-brand-grey-700">
                No learners yet. Invite your first one above.
              </p>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-brand-grey-50">
                  <tr>
                    <Th>Email</Th>
                    <Th>Name</Th>
                    <Th>Track</Th>
                    <Th>Added</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-grey-200">
                  {learners.map((l) => (
                    <tr key={l.id}>
                      <Td>
                        <span className="font-body text-sm text-brand-black">
                          {l.email}
                        </span>
                      </Td>
                      <Td>
                        <span className="font-body text-sm text-brand-grey-700">
                          {l.name ?? "—"}
                        </span>
                      </Td>
                      <Td>
                        <span className="font-body text-sm text-brand-grey-700">
                          {l.ielts_track === "Academic"
                            ? "Academic"
                            : "General Training"}
                        </span>
                      </Td>
                      <Td>
                        <time
                          dateTime={l.createdAt.toISOString()}
                          className="font-body text-sm text-brand-grey-700"
                        >
                          {l.createdAt.toLocaleDateString()}
                        </time>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-6 py-3 font-body text-xs uppercase tracking-widest text-brand-grey-500">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-6 py-3">{children}</td>;
}
