import type { Metadata } from "next";
import Link from "next/link";
import { SYSTEM_ORG_ID, withSuperAdminContext } from "@elc/db";
import { requireRole } from "@/lib/auth/context";

export const metadata: Metadata = {
  title: "Organisations · SuperAdmin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = {
  created?: string;
  error?: string;
};

function startOfUtcToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function statusBadgeClasses(status: "Active" | "Suspended" | "Archived") {
  if (status === "Active") {
    return "bg-brand-black text-white";
  }
  if (status === "Suspended") {
    return "bg-brand-red-soft text-brand-grey-900 ring-1 ring-brand-red/40";
  }
  return "bg-brand-grey-200 text-brand-grey-700";
}

export default async function OrgsListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);
  const sp = await searchParams;

  const orgs = await db.organization.findMany({
    where: { id: { not: SYSTEM_ORG_ID } },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      status: true,
      seat_limit: true,
      quota_daily: true,
      quota_monthly: true,
      _count: { select: { users: true } },
    },
  });

  // Today's AI calls per org, in one grouped query. Index on
  // (org_id, date) makes this cheap.
  const usageRows = await db.quotaUsage.groupBy({
    by: ["org_id"],
    where: { date: startOfUtcToday() },
    _sum: { ai_calls_count: true },
  });
  const usageByOrg = new Map<string, number>(
    usageRows.map((r) => [r.org_id, r._sum.ai_calls_count ?? 0]),
  );

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-body text-sm uppercase tracking-widest text-brand-red">
              SuperAdmin
            </p>
            <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
              Organisations.
            </h1>
            <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
              Every customer organisation on the platform. Seat limits, AI
              quotas, and lifecycle status are managed here.
            </p>
          </div>
          <Link
            href="/orgs/new"
            className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
          >
            Create organisation
          </Link>
        </header>

        {sp.created ? (
          <Banner tone="success">
            Organisation created. Configure quotas below or invite an admin
            from the detail page.
          </Banner>
        ) : null}
        {sp.error ? (
          <Banner tone="error">
            Could not complete that action: <code>{sp.error}</code>.
          </Banner>
        ) : null}

        <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 overflow-hidden">
          {orgs.length === 0 ? (
            <p className="px-6 py-8 font-body text-base text-brand-grey-700">
              No organisations yet. Create one to onboard a customer.
            </p>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-brand-grey-50">
                <tr>
                  <Th>Name</Th>
                  <Th>Status</Th>
                  <Th>Seats</Th>
                  <Th>Daily quota</Th>
                  <Th>Used today</Th>
                  <Th>{""}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-grey-200">
                {orgs.map((org) => {
                  const usedToday = usageByOrg.get(org.id) ?? 0;
                  return (
                    <tr key={org.id}>
                      <Td>
                        <Link
                          href={`/orgs/${org.id}`}
                          className="font-heading font-bold text-sm text-brand-black hover:text-brand-red underline-offset-4 hover:underline"
                        >
                          {org.name}
                        </Link>
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex items-center rounded-pill px-3 py-1 font-heading font-bold text-xs ${statusBadgeClasses(org.status)}`}
                        >
                          {org.status}
                        </span>
                      </Td>
                      <Td>
                        <span className="font-body text-sm text-brand-grey-700">
                          {org._count.users} / {org.seat_limit || "—"}
                        </span>
                      </Td>
                      <Td>
                        <span className="font-body text-sm text-brand-grey-700">
                          {org.quota_daily || "—"}
                        </span>
                      </Td>
                      <Td>
                        <span className="font-body text-sm text-brand-grey-700">
                          {usedToday}
                        </span>
                      </Td>
                      <Td>
                        <Link
                          href={`/orgs/${org.id}`}
                          className="font-body text-sm text-brand-black hover:text-brand-red underline-offset-4 hover:underline"
                        >
                          Manage →
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
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
  return <td className="px-6 py-3 align-middle">{children}</td>;
}

function Banner({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: React.ReactNode;
}) {
  const styles =
    tone === "error"
      ? "bg-brand-red-soft ring-brand-red/40 text-brand-grey-900"
      : "bg-brand-white ring-brand-grey-200 text-brand-grey-900";
  return (
    <div className={`rounded-lg ring-1 px-5 py-3 ${styles}`}>
      <p className="font-body text-sm">{children}</p>
    </div>
  );
}
