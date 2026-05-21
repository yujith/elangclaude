// Phase 3 — cross-org metrics for the SuperAdmin console.
//
// Pure DB-touching helpers. The Next route in
// apps/web/app/(super)/metrics/page.tsx is a thin wrapper that runs
// requireRole("SuperAdmin") and calls these functions. Keeping the
// SQL here lets the fuzzer assert aggregation correctness without
// booting Next.
//
// All reads go through withSuperAdminContext(ctx) — these are cross-org
// by definition. The SuperAdmin role check inside throws if a non-super
// caller slips through, so the helpers double as access-control guards.
//
// Numbers are bucketed by UTC date (Postgres DATE column on QuotaUsage).
// The dashboard treats "today" as start-of-UTC-today; reporting in a
// single timezone keeps day-rollover behaviour predictable across orgs.

import { SYSTEM_ORG_ID } from "./system-org";
import { withSuperAdminContext, type OrgContext } from "./tenancy";

export type DailyCallPoint = {
  date: string; // YYYY-MM-DD (UTC)
  ai_calls: number;
};

export type OrgLeaderboardRow = {
  org_id: string;
  name: string;
  status: "Active" | "Suspended" | "Archived";
  calls_today: number;
  calls_7d: number;
  calls_30d: number;
  spend_30d_usd: number;
};

export type MetricsOverview = {
  // Day window starts (UTC) so the route can show "as of 2026-05-20".
  today: string;
  totals: {
    calls_today: number;
    calls_7d: number;
    calls_30d: number;
    active_orgs: number;
    active_learners_today: number;
    spend_30d_usd: number;
  };
  // Most recent N days, oldest → newest. Used by the dashboard sparkbar.
  daily: DailyCallPoint[];
  // Customer orgs only (system + archived excluded), sorted by calls_30d desc.
  leaderboard: OrgLeaderboardRow[];
};

// Inclusive lower bound; rows with date >= since are included.
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysAgo(n: number, ref: Date): Date {
  const base = startOfUtcDay(ref);
  return new Date(base.getTime() - n * 24 * 60 * 60 * 1000);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const DAILY_WINDOW_DAYS = 30;

export async function loadMetricsOverview(
  ctx: OrgContext,
  now: Date = new Date(),
): Promise<MetricsOverview> {
  const db = withSuperAdminContext(ctx);
  const today = startOfUtcDay(now);
  const sevenDaysAgo = daysAgo(6, now); // last 7 calendar days incl. today
  const thirtyDaysAgo = daysAgo(29, now);
  const windowStart = daysAgo(DAILY_WINDOW_DAYS - 1, now);

  // Customer orgs only. SuperAdmin still wants to spot a suspended org's
  // spike, so we keep Suspended; Archived rolls off the dashboard because
  // it should not be accruing usage anyway.
  const orgs = await db.organization.findMany({
    where: {
      id: { not: SYSTEM_ORG_ID },
      status: { in: ["Active", "Suspended"] },
    },
    select: { id: true, name: true, status: true },
    orderBy: { name: "asc" },
  });
  const orgIds = orgs.map((o) => o.id);

  // Pull the last 30 days of QuotaUsage in one go. Index (org_id, date)
  // makes this cheap; we groupBy in JS to avoid 30× Prisma round-trips.
  const usageRows =
    orgIds.length === 0
      ? []
      : await db.quotaUsage.findMany({
          where: {
            org_id: { in: orgIds },
            date: { gte: windowStart },
          },
          select: {
            org_id: true,
            user_id: true,
            date: true,
            ai_calls_count: true,
          },
        });

  // ── Roll up by (org_id, day) and by day-only for the global series ──
  const byOrg = new Map<
    string,
    { today: number; sevenD: number; thirtyD: number }
  >();
  const byDate = new Map<string, number>();
  const activeLearners = new Set<string>();
  for (const o of orgs) byOrg.set(o.id, { today: 0, sevenD: 0, thirtyD: 0 });

  const todayKey = isoDate(today);
  const sevenKey = isoDate(sevenDaysAgo);

  for (const row of usageRows) {
    const k = isoDate(row.date);
    byDate.set(k, (byDate.get(k) ?? 0) + row.ai_calls_count);
    const orgBucket = byOrg.get(row.org_id);
    if (orgBucket) {
      orgBucket.thirtyD += row.ai_calls_count;
      if (k >= sevenKey) orgBucket.sevenD += row.ai_calls_count;
      if (k === todayKey) orgBucket.today += row.ai_calls_count;
    }
    if (k === todayKey && row.ai_calls_count > 0) {
      activeLearners.add(row.user_id);
    }
  }

  // Fill the sparkbar series with explicit zeros for empty days — the
  // chart should still show 30 bars when an org has no traffic.
  const daily: DailyCallPoint[] = [];
  for (let i = DAILY_WINDOW_DAYS - 1; i >= 0; i--) {
    const d = daysAgo(i, now);
    const k = isoDate(d);
    daily.push({ date: k, ai_calls: byDate.get(k) ?? 0 });
  }

  // 30-day spend roll-up from AiCallLog. Falls back to 0 when an org
  // has no logged calls (or when the gateway hasn't started writing yet).
  // Aggregate at the SQL layer to avoid pulling every row into JS.
  const spendRows =
    orgIds.length === 0
      ? []
      : await db.aiCallLog.groupBy({
          by: ["org_id"],
          where: {
            org_id: { in: orgIds },
            createdAt: { gte: thirtyDaysAgo },
          },
          _sum: { cost_usd: true },
        });
  const spendByOrg = new Map<string, number>(
    spendRows.map((r) => [r.org_id, Number(r._sum.cost_usd ?? 0)]),
  );

  const leaderboard: OrgLeaderboardRow[] = orgs
    .map((o) => {
      const bucket = byOrg.get(o.id) ?? { today: 0, sevenD: 0, thirtyD: 0 };
      return {
        org_id: o.id,
        name: o.name,
        status: o.status,
        calls_today: bucket.today,
        calls_7d: bucket.sevenD,
        calls_30d: bucket.thirtyD,
        spend_30d_usd: spendByOrg.get(o.id) ?? 0,
      };
    })
    .sort((a, b) => b.calls_30d - a.calls_30d || a.name.localeCompare(b.name));

  let calls_today = 0;
  let calls_7d = 0;
  let calls_30d = 0;
  let spend_30d_usd = 0;
  for (const row of leaderboard) {
    calls_today += row.calls_today;
    calls_7d += row.calls_7d;
    calls_30d += row.calls_30d;
    spend_30d_usd += row.spend_30d_usd;
  }
  // An org "is active" today if it logged at least one AI call.
  const active_orgs = leaderboard.filter((r) => r.calls_today > 0).length;

  return {
    today: todayKey,
    totals: {
      calls_today,
      calls_7d,
      calls_30d,
      active_orgs,
      active_learners_today: activeLearners.size,
      spend_30d_usd,
    },
    daily,
    leaderboard,
  };
}
