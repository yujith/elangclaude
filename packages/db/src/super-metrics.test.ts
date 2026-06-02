import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { loadMetricsOverview } from "./super-metrics";
import { SYSTEM_ORG_ID, SYSTEM_ORG_NAME } from "./system-org";
import { RoleRequiredError } from "./tenancy";
import { createTestOrg, ctxFor, resetDatabase } from "./test-helpers";

async function ensureSystemOrg() {
  await prisma.organization.upsert({
    where: { id: SYSTEM_ORG_ID },
    update: { name: SYSTEM_ORG_NAME, status: "Archived" },
    create: {
      id: SYSTEM_ORG_ID,
      name: SYSTEM_ORG_NAME,
      seat_limit: 0,
      quota_daily: 0,
      quota_monthly: 0,
      status: "Archived",
    },
  });
}

function utcDay(daysAgoFromRef: number, ref: Date): Date {
  const base = new Date(
    Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()),
  );
  return new Date(base.getTime() - daysAgoFromRef * 24 * 60 * 60 * 1000);
}

beforeEach(async () => {
  await resetDatabase();
  await ensureSystemOrg();
});

describe("loadMetricsOverview", () => {
  it("aggregates call counts by org and date window", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    const now = new Date("2026-05-20T12:00:00.000Z");

    // Hand-seeded usage. Two days, two orgs, each learner contributes
    // distinct values so a wrong sum surfaces immediately.
    // org A: today=5+3, 7d window also captures yesterday=2 → 10/total
    // org B: today=4, 7d=4
    await prisma.quotaUsage.createMany({
      data: [
        {
          org_id: orgA.id,
          user_id: orgA.learnerIds[0]!,
          date: utcDay(0, now),
          ai_calls_count: 5,
        },
        {
          org_id: orgA.id,
          user_id: orgA.learnerIds[1]!,
          date: utcDay(0, now),
          ai_calls_count: 3,
        },
        {
          org_id: orgA.id,
          user_id: orgA.learnerIds[0]!,
          date: utcDay(1, now),
          ai_calls_count: 2,
        },
        {
          org_id: orgB.id,
          user_id: orgB.learnerIds[0]!,
          date: utcDay(0, now),
          ai_calls_count: 4,
        },
      ],
    });

    const overview = await loadMetricsOverview(
      ctxFor(orgA, "SuperAdmin"),
      now,
    );

    expect(overview.totals.calls_today).toBe(12); // 5+3+4
    expect(overview.totals.calls_7d).toBe(14); // 12 + 2
    expect(overview.totals.calls_30d).toBe(14);
    expect(overview.totals.active_orgs).toBe(2);
    // org A has 2 distinct learners active today, org B has 1.
    expect(overview.totals.active_learners_today).toBe(3);

    const lead = new Map(overview.leaderboard.map((r) => [r.org_id, r]));
    expect(lead.get(orgA.id)).toMatchObject({
      calls_today: 8,
      calls_7d: 10,
      calls_30d: 10,
    });
    expect(lead.get(orgB.id)).toMatchObject({
      calls_today: 4,
      calls_7d: 4,
      calls_30d: 4,
    });
    // Sort order: org A first because 30d=10 > 4.
    expect(overview.leaderboard[0]?.org_id).toBe(orgA.id);

    // 30-day daily series has 30 entries, ordered oldest → newest.
    expect(overview.daily).toHaveLength(30);
    expect(overview.daily[overview.daily.length - 1]?.date).toBe("2026-05-20");
    expect(overview.daily[overview.daily.length - 1]?.ai_calls).toBe(12);
    expect(overview.daily[overview.daily.length - 2]?.date).toBe("2026-05-19");
    expect(overview.daily[overview.daily.length - 2]?.ai_calls).toBe(2);
  });

  it("excludes the system org and Archived orgs from the leaderboard", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    await prisma.organization.update({
      where: { id: orgB.id },
      data: { status: "Archived" },
    });
    // System org has no usage, but verify it's not in the list regardless.
    await prisma.quotaUsage.create({
      data: {
        org_id: orgA.id,
        user_id: orgA.learnerIds[0]!,
        date: new Date(
          Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate(),
          ),
        ),
        ai_calls_count: 1,
      },
    });

    const overview = await loadMetricsOverview(ctxFor(orgA, "SuperAdmin"));
    const ids = overview.leaderboard.map((r) => r.org_id);
    expect(ids).toContain(orgA.id);
    expect(ids).not.toContain(orgB.id);
    expect(ids).not.toContain(SYSTEM_ORG_ID);
  });

  it("rejects non-SuperAdmin callers", async () => {
    const orgA = await createTestOrg("A");
    await expect(
      loadMetricsOverview(ctxFor(orgA, "OrgAdmin")),
    ).rejects.toBeInstanceOf(RoleRequiredError);
    await expect(
      loadMetricsOverview(ctxFor(orgA, "Learner")),
    ).rejects.toBeInstanceOf(RoleRequiredError);
  });

  it("rolls up 30-day spend per org from AiCallLog", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    const now = new Date("2026-05-21T12:00:00.000Z");
    // 28 days ago = inside the window. 31 days ago = outside.
    const insideWindow = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
    const outsideWindow = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);

    await prisma.aiCallLog.createMany({
      data: [
        {
          org_id: orgA.id,
          user_id: orgA.learnerIds[0]!,
          purpose: "writing-grade",
          provider: "anthropic",
          model: "claude-sonnet-4-5-20250929",
          input_tokens: 1000,
          output_tokens: 500,
          cost_usd: "0.123456",
          createdAt: insideWindow,
        },
        {
          org_id: orgA.id,
          user_id: orgA.learnerIds[0]!,
          purpose: "writing-grade",
          provider: "anthropic",
          model: "claude-sonnet-4-5-20250929",
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: "1.876544",
          createdAt: insideWindow,
        },
        {
          org_id: orgB.id,
          user_id: orgB.learnerIds[0]!,
          purpose: "reading-generate",
          provider: "openrouter",
          model: "google/gemini-2.5-flash",
          input_tokens: 100,
          output_tokens: 50,
          cost_usd: "0.500000",
          createdAt: insideWindow,
        },
        // Outside the window — must not be counted.
        {
          org_id: orgA.id,
          user_id: orgA.learnerIds[0]!,
          purpose: "writing-grade",
          provider: "anthropic",
          model: "claude-sonnet-4-5-20250929",
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: "99.000000",
          createdAt: outsideWindow,
        },
      ],
    });

    const overview = await loadMetricsOverview(
      ctxFor(orgA, "SuperAdmin"),
      now,
    );
    const lead = new Map(overview.leaderboard.map((r) => [r.org_id, r]));
    // 0.123456 + 1.876544 = 2.000000 exact
    expect(lead.get(orgA.id)?.spend_30d_usd).toBeCloseTo(2, 4);
    expect(lead.get(orgB.id)?.spend_30d_usd).toBeCloseTo(0.5, 4);
    // Org A's 31-day-old $99 row is excluded.
    expect(overview.totals.spend_30d_usd).toBeCloseTo(2.5, 4);
  });
});
