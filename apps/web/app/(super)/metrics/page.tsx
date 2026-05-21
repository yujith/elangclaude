import type { Metadata } from "next";
import Link from "next/link";
import { loadMetricsOverview } from "@elc/db/super-metrics";
import { requireRole } from "@/lib/auth/context";

export const metadata: Metadata = {
  title: "Metrics · SuperAdmin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function statusBadgeClasses(status: "Active" | "Suspended" | "Archived") {
  if (status === "Active") return "bg-brand-black text-white";
  if (status === "Suspended") {
    return "bg-brand-red-soft text-brand-grey-900 ring-1 ring-brand-red/40";
  }
  return "bg-brand-grey-200 text-brand-grey-700";
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatUsd(n: number): string {
  // Sub-cent spend is normal on free-tier traffic; show 2 dp once we
  // cross a dollar, 4 dp below that so a $0.0023 row doesn't render as $0.00.
  const digits = n >= 1 ? 2 : 4;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export default async function MetricsPage() {
  const ctx = await requireRole("SuperAdmin");
  const overview = await loadMetricsOverview(ctx);

  const peakDaily = Math.max(1, ...overview.daily.map((d) => d.ai_calls));

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl space-y-10">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            SuperAdmin
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Metrics.
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
            Cross-organisation AI call volume, sourced from{" "}
            <code>QuotaUsage</code>. Token-level cost will land in a follow-up
            phase &mdash; counts are the right primitive for now.
          </p>
          <p className="mt-2 font-body text-xs text-brand-grey-500">
            As of {overview.today} (UTC).
          </p>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Calls today" value={formatNumber(overview.totals.calls_today)} />
          <Stat label="Calls last 30d" value={formatNumber(overview.totals.calls_30d)} />
          <Stat
            label="Spend last 30d"
            value={formatUsd(overview.totals.spend_30d_usd)}
            sub="Estimated from public pricing"
          />
          <Stat
            label="Active today"
            value={`${overview.totals.active_orgs} orgs`}
            sub={`${overview.totals.active_learners_today} learners`}
          />
        </div>

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
          <h2 className="font-heading font-bold text-lg text-brand-black">
            Daily volume (last 30 days)
          </h2>
          <p className="mt-1 font-body text-sm text-brand-grey-700">
            One bar per UTC day. Peak: {formatNumber(peakDaily)} calls.
          </p>
          <ol
            // items-stretch (the default) makes each <li> fill the
            // 160px cross-axis so the bar's height-% computes against
            // a real height. items-end was the previous bug: it
            // collapsed each <li> to content-height (0), so % heights
            // resolved to 0px and the chart rendered as a blank strip.
            className="mt-5 flex items-stretch gap-1 h-40"
            aria-label="Daily AI call volume, last 30 days"
          >
            {overview.daily.map((day) => {
              const ratio = day.ai_calls / peakDaily;
              const heightPct = Math.max(2, Math.round(ratio * 100));
              return (
                <li
                  key={day.date}
                  className="flex-1 flex flex-col justify-end h-full"
                  title={`${day.date}: ${formatNumber(day.ai_calls)} calls`}
                >
                  <div
                    className={`w-full rounded-sm ${
                      day.ai_calls > 0 ? "bg-brand-red" : "bg-brand-grey-200"
                    }`}
                    style={{ height: `${heightPct}%`, minHeight: "2px" }}
                    aria-hidden="true"
                  />
                  <span className="sr-only">
                    {day.date}: {day.ai_calls} calls
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="mt-2 flex justify-between font-body text-xs text-brand-grey-500">
            <span>{overview.daily[0]?.date}</span>
            <span>{overview.daily[overview.daily.length - 1]?.date}</span>
          </div>
        </section>

        <section>
          <h2 className="font-heading font-bold text-xl text-brand-black mb-4">
            Organisation leaderboard
          </h2>
          <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 overflow-hidden">
            {overview.leaderboard.length === 0 ? (
              <p className="px-6 py-8 font-body text-base text-brand-grey-700">
                No customer organisations to report on yet. Create one from{" "}
                <Link
                  href="/orgs"
                  className="text-brand-black underline-offset-4 hover:underline"
                >
                  /orgs
                </Link>
                .
              </p>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-brand-grey-50">
                  <tr>
                    <Th>Org</Th>
                    <Th>Status</Th>
                    <Th align="right">Today</Th>
                    <Th align="right">7d</Th>
                    <Th align="right">30d</Th>
                    <Th align="right">Spend 30d</Th>
                    <Th>{""}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-grey-200">
                  {overview.leaderboard.map((row) => (
                    <tr key={row.org_id}>
                      <Td>
                        <Link
                          href={`/orgs/${row.org_id}`}
                          className="font-heading font-bold text-sm text-brand-black hover:text-brand-red underline-offset-4 hover:underline"
                        >
                          {row.name}
                        </Link>
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex items-center rounded-pill px-3 py-1 font-heading font-bold text-xs ${statusBadgeClasses(row.status)}`}
                        >
                          {row.status}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="font-body text-sm text-brand-black tabular-nums">
                          {formatNumber(row.calls_today)}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="font-body text-sm text-brand-grey-700 tabular-nums">
                          {formatNumber(row.calls_7d)}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="font-body text-sm text-brand-grey-700 tabular-nums">
                          {formatNumber(row.calls_30d)}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="font-body text-sm text-brand-black tabular-nums">
                          {row.spend_30d_usd > 0
                            ? formatUsd(row.spend_30d_usd)
                            : "—"}
                        </span>
                      </Td>
                      <Td>
                        <Link
                          href={`/orgs/${row.org_id}`}
                          className="font-body text-sm text-brand-black hover:text-brand-red underline-offset-4 hover:underline"
                        >
                          Open →
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-5">
      <p className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
        {label}
      </p>
      <p className="mt-1 font-display italic font-bold text-3xl text-brand-black leading-none">
        {value}
      </p>
      {sub ? (
        <p className="mt-1 font-body text-sm text-brand-grey-700">{sub}</p>
      ) : null}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-6 py-3 font-body text-xs uppercase tracking-widest text-brand-grey-500 ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      className={`px-6 py-3 align-middle ${align === "right" ? "text-right" : ""}`}
    >
      {children}
    </td>
  );
}
