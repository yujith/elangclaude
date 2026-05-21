import type { Metadata } from "next";
import { prisma } from "@elc/db/client";
import { withOrg } from "@elc/db";
import { requireRole } from "@/lib/auth/context";

export const metadata: Metadata = {
  title: "Org admin · Overview",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function startOfUtcToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function formatRelative(ts: Date): string {
  const diffMs = Date.now() - ts.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default async function OrgAdminOverviewPage() {
  const ctx = await requireRole("OrgAdmin");
  const db = withOrg(ctx);

  // Organization is global (not tenant-scoped); fetch by ctx.org_id only,
  // never by user input.
  const [org, learnerCount, quotaSum, recentActivity] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: ctx.org_id },
      select: { name: true, seat_limit: true, quota_daily: true, status: true },
    }),
    db.user.count({ where: { role: "Learner" } }),
    db.quotaUsage.aggregate({
      _sum: { ai_calls_count: true },
      where: { date: startOfUtcToday() },
    }),
    db.activityLog.findMany({
      // SuperAdmin content.* events live under SYSTEM_ORG_ID, so withOrg(ctx)
      // already excludes them — no special filter needed here.
      orderBy: { timestamp: "desc" },
      take: 5,
      select: {
        id: true,
        action: true,
        timestamp: true,
        metadata: true,
        user: { select: { name: true, email: true } },
      },
    }),
  ]);

  const seatLimit = org?.seat_limit ?? 0;
  const seatPct =
    seatLimit > 0
      ? Math.min(100, Math.round((learnerCount / seatLimit) * 100))
      : 0;

  const aiCallsToday = quotaSum._sum.ai_calls_count ?? 0;
  const quotaDaily = org?.quota_daily ?? 0;
  const quotaPct =
    quotaDaily > 0
      ? Math.min(100, Math.round((aiCallsToday / quotaDaily) * 100))
      : 0;

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl space-y-10">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Org admin
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            {org?.name ?? "Your organisation"}.
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
            At-a-glance view of your seat usage, today&rsquo;s AI quota, and the
            most recent activity in your organisation.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <UsageCard
            label="Seats used"
            value={`${learnerCount} / ${seatLimit}`}
            sub={
              seatLimit === 0
                ? "No seat limit set."
                : `${seatLimit - learnerCount} remaining`
            }
            pct={seatPct}
          />
          <UsageCard
            label="AI calls today"
            value={`${aiCallsToday} / ${quotaDaily}`}
            sub={
              quotaDaily === 0
                ? "No daily quota configured."
                : `${Math.max(0, quotaDaily - aiCallsToday)} remaining today`
            }
            pct={quotaPct}
          />
        </div>

        <div>
          <h2 className="font-heading font-bold text-xl text-brand-black">
            Recent activity
          </h2>
          <div className="mt-4 rounded-lg bg-brand-white ring-1 ring-brand-grey-200 overflow-hidden">
            {recentActivity.length === 0 ? (
              <p className="px-6 py-8 font-body text-base text-brand-grey-700">
                Nothing has happened in your organisation yet. Once you invite
                learners and they take tests, you&rsquo;ll see events here.
              </p>
            ) : (
              <ul className="divide-y divide-brand-grey-200">
                {recentActivity.map((row) => (
                  <li
                    key={row.id}
                    className="px-6 py-4 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="font-heading font-bold text-sm text-brand-black truncate">
                        {row.action}
                      </p>
                      <p className="font-body text-xs text-brand-grey-700 truncate">
                        {row.user?.name ?? row.user?.email ?? "—"}
                      </p>
                    </div>
                    <time
                      dateTime={row.timestamp.toISOString()}
                      className="font-body text-xs text-brand-grey-500 whitespace-nowrap"
                    >
                      {formatRelative(row.timestamp)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function UsageCard({
  label,
  value,
  sub,
  pct,
}: {
  label: string;
  value: string;
  sub: string;
  pct: number;
}) {
  return (
    <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
      <p className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
        {label}
      </p>
      <p className="mt-2 font-display italic font-bold text-3xl text-brand-black">
        {value}
      </p>
      <p className="mt-1 font-body text-sm text-brand-grey-700">{sub}</p>
      <div
        className="mt-4 h-1.5 w-full rounded-full bg-brand-grey-200 overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-brand-red"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
