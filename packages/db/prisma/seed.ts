// Seed: 1 SuperAdmin + 2 demo orgs (each with 1 OrgAdmin + 2 Learners).
//
// Idempotent. Re-running is a no-op. Stable IDs make the rows easy to spot in
// `prisma studio` or `psql`. No Tests/Questions are seeded here — those live
// in the IELTS-content session once we have real material to put in.
//
// SAFETY: this runs against whatever DATABASE_URL is set. Seed is wired into
// `prisma db seed` and `prisma migrate dev` — never run it against prod.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SUPER_EMAIL = "super@elanguage.test";

type OrgSpec = {
  id: string;
  name: string;
  seat_limit: number;
  quota_daily: number;
  quota_monthly: number;
};

const ORG_A: OrgSpec = {
  id: "seed_org_demo_english_academy",
  name: "Demo English Academy",
  seat_limit: 25,
  quota_daily: 100,
  quota_monthly: 2000,
};

const ORG_B: OrgSpec = {
  id: "seed_org_migration_pathways",
  name: "Migration Pathways Co",
  seat_limit: 10,
  quota_daily: 50,
  quota_monthly: 1000,
};

async function upsertOrg(spec: OrgSpec) {
  return prisma.organization.upsert({
    where: { id: spec.id },
    update: {
      name: spec.name,
      seat_limit: spec.seat_limit,
      quota_daily: spec.quota_daily,
      quota_monthly: spec.quota_monthly,
    },
    create: { ...spec },
  });
}

async function upsertUser(input: {
  org_id: string;
  email: string;
  name: string;
  role: "SuperAdmin" | "OrgAdmin" | "Learner";
}) {
  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      org_id: input.org_id,
      name: input.name,
      role: input.role,
    },
    create: input,
  });
}

async function main() {
  // The SuperAdmin still needs to live in *some* organization (the schema
  // requires `User.org_id`). Park them inside Org A — `withSuperAdminContext`
  // ignores org membership anyway.
  const orgA = await upsertOrg(ORG_A);
  const orgB = await upsertOrg(ORG_B);

  await upsertUser({
    org_id: orgA.id,
    email: SUPER_EMAIL,
    name: "Super Admin",
    role: "SuperAdmin",
  });

  await upsertUser({
    org_id: orgA.id,
    email: "admin-a@elanguage.test",
    name: "Demo English Admin",
    role: "OrgAdmin",
  });
  await upsertUser({
    org_id: orgA.id,
    email: "learner-a1@elanguage.test",
    name: "Anika (Demo English)",
    role: "Learner",
  });
  await upsertUser({
    org_id: orgA.id,
    email: "learner-a2@elanguage.test",
    name: "Bilal (Demo English)",
    role: "Learner",
  });

  await upsertUser({
    org_id: orgB.id,
    email: "admin-b@elanguage.test",
    name: "Migration Pathways Admin",
    role: "OrgAdmin",
  });
  await upsertUser({
    org_id: orgB.id,
    email: "learner-b1@elanguage.test",
    name: "Carmen (Migration Pathways)",
    role: "Learner",
  });
  await upsertUser({
    org_id: orgB.id,
    email: "learner-b2@elanguage.test",
    name: "Devraj (Migration Pathways)",
    role: "Learner",
  });

  const userCount = await prisma.user.count();
  const orgCount = await prisma.organization.count({
    where: { id: { in: [orgA.id, orgB.id] } },
  });

  console.log(
    `Seed complete: ${orgCount} demo orgs, ${userCount} users in DB ` +
      `(SuperAdmin: ${SUPER_EMAIL}).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
