import { Prisma, type Section, type Track } from "@prisma/client";
import { prisma } from "./client.js";
import type { OrgContext } from "./tenancy.js";
import { TENANT_SCOPED_MODELS } from "./tenancy.js";

// ─── Truncate everything between tests ────────────────────────────────────
//
// Faster than dropping + re-migrating. Deferring constraint checks keeps the
// FK graph happy without ordering. Always run against the test branch — the
// global setup forces DATABASE_URL → DATABASE_URL_TEST so this is safe.

export async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '_prisma_%'
  `;
  if (tables.length === 0) return;
  const names = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`,
  );
}

// ─── Seeding fixtures for the fuzzer ──────────────────────────────────────

export type TestOrg = {
  id: string;
  adminId: string;
  learnerIds: string[];
};

export async function createTestOrg(label: string): Promise<TestOrg> {
  const org = await prisma.organization.create({
    data: {
      name: `Test Org ${label}`,
      seat_limit: 10,
      quota_daily: 100,
      quota_monthly: 1000,
    },
  });
  const admin = await prisma.user.create({
    data: {
      org_id: org.id,
      email: `admin-${label}-${cryptoRandom()}@elanguage.test`,
      name: `Admin ${label}`,
      role: "OrgAdmin",
    },
  });
  const learners = await Promise.all(
    [1, 2, 3].map((i) =>
      prisma.user.create({
        data: {
          org_id: org.id,
          email: `learner-${label}-${i}-${cryptoRandom()}@elanguage.test`,
          name: `Learner ${label} ${i}`,
          role: "Learner",
        },
      }),
    ),
  );
  return {
    id: org.id,
    adminId: admin.id,
    learnerIds: learners.map((u) => u.id),
  };
}

export async function seedActivity(
  org: TestOrg,
  attemptsPerLearner: number,
): Promise<{ testId: string; attemptIds: string[] }> {
  // Tests are global content — created once per fuzzer run, not per org.
  const test = await prisma.test.create({
    data: {
      track: "Academic" satisfies Track,
      section: "Reading" satisfies Section,
      difficulty: 5,
      status: "Approved",
    },
  });
  const attemptIds: string[] = [];
  for (const learnerId of org.learnerIds) {
    for (let i = 0; i < attemptsPerLearner; i++) {
      const attempt = await prisma.attempt.create({
        data: {
          org_id: org.id,
          user_id: learnerId,
          test_id: test.id,
          section: "Reading",
          status: "Submitted",
          submitted_at: new Date(),
        },
      });
      attemptIds.push(attempt.id);
      await prisma.activityLog.create({
        data: {
          org_id: org.id,
          user_id: learnerId,
          action: "attempt.submitted",
          metadata: { attempt_id: attempt.id, section: "Reading" },
        },
      });
    }
  }
  return { testId: test.id, attemptIds };
}

export function ctxFor(org: TestOrg, role: OrgContext["role"] = "OrgAdmin"): OrgContext {
  return { org_id: org.id, user_id: org.adminId, role };
}

// ─── Drift guard: TENANT_SCOPED_MODELS vs the live datamodel ──────────────
//
// Checks that every Prisma model with an `org_id` column is in
// TENANT_SCOPED_MODELS, and vice-versa. Pulled into the fuzzer as one of the
// asserts.

export function findTenantSetDrift(): {
  missingFromSet: string[];
  extraInSet: string[];
} {
  const liveOrgIdModels = new Set<string>(
    Prisma.dmmf.datamodel.models
      .filter((m) => m.fields.some((f) => f.name === "org_id"))
      .map((m) => m.name),
  );
  const declared = new Set<string>(TENANT_SCOPED_MODELS);
  const missingFromSet = [...liveOrgIdModels].filter((m) => !declared.has(m));
  const extraInSet = [...declared].filter((m) => !liveOrgIdModels.has(m));
  return { missingFromSet, extraInSet };
}

function cryptoRandom(): string {
  // 6 hex chars is enough to avoid email collisions across tests within a run.
  return Math.random().toString(16).slice(2, 8);
}
