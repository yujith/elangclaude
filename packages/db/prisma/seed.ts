// Seed: 1 SuperAdmin + 2 demo orgs (each with 1 OrgAdmin + 2 Learners) +
// a starter pool of approved Writing tests (Academic T1 + T2, GT T1 + T2)
// so the learner UI has real content to drill against on day one.
//
// Idempotent. Re-running is a no-op. Stable IDs make the rows easy to spot in
// `prisma studio` or `psql`.
//
// SAFETY: this runs against whatever DATABASE_URL is set. Seed is wired into
// `prisma db seed` and `prisma migrate dev` — never run it against prod.

import { Prisma, PrismaClient, type Track } from "@prisma/client";

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

type WritingVisual =
  | {
      kind: "bar";
      title?: string;
      x_label?: string;
      y_label?: string;
      unit?: string;
      categories: string[];
      series: { name: string; values: number[] }[];
    }
  | {
      kind: "process";
      title?: string;
      steps: { label: string; detail?: string }[];
    };

type WritingTaskSpec = {
  id: string;
  questionId: string;
  track: Track;
  difficulty: number;
  type: "writing-task-1-academic" | "writing-task-1-general" | "writing-task-2";
  prompt: string;
  visual?: WritingVisual;
};

// Six hand-written tasks: enough to populate the learner picker for both
// tracks and let the demo cover Task 1 + Task 2 drills without AI generation.
// Stable IDs (one per task) keep upserts idempotent. The companion Question
// shares the same stable suffix so re-runs don't fork the relation.
const WRITING_TASKS: WritingTaskSpec[] = [
  {
    id: "seed_test_writing_acad_t1_bar",
    questionId: "seed_q_writing_acad_t1_bar",
    track: "Academic",
    difficulty: 5,
    type: "writing-task-1-academic",
    prompt:
      "The bar chart below shows the percentage of households with internet access in four countries (the United Kingdom, France, Germany, and Italy) in 2010 and 2022.\n\nSummarise the information by selecting and reporting the main features, and make comparisons where relevant.\n\nWrite at least 150 words.",
    visual: {
      kind: "bar",
      title: "Households with internet access (% of total)",
      unit: "%",
      categories: ["United Kingdom", "France", "Germany", "Italy"],
      series: [
        { name: "2010", values: [71, 64, 75, 59] },
        { name: "2022", values: [96, 91, 94, 85] },
      ],
    },
  },
  {
    id: "seed_test_writing_acad_t1_process",
    questionId: "seed_q_writing_acad_t1_process",
    track: "Academic",
    difficulty: 6,
    type: "writing-task-1-academic",
    prompt:
      "The diagram below shows the process by which bottled drinking water is produced.\n\nSummarise the information by selecting and reporting the main features, and make comparisons where relevant.\n\nWrite at least 150 words.",
    visual: {
      kind: "process",
      title: "Bottled drinking water — production process",
      steps: [
        { label: "Underground spring", detail: "Water drawn from a natural source." },
        { label: "Filter", detail: "Sediment and particles removed." },
        { label: "UV treatment", detail: "Light kills any remaining bacteria." },
        { label: "Chill", detail: "Water cooled to bottling temperature." },
        { label: "Bottle & seal", detail: "Filled into bottles and sealed shut." },
        { label: "Label & pack", detail: "Labelled and crated for distribution." },
      ],
    },
  },
  {
    id: "seed_test_writing_acad_t2_essay",
    questionId: "seed_q_writing_acad_t2_essay",
    track: "Academic",
    difficulty: 6,
    type: "writing-task-2",
    prompt:
      "Some people believe that universities should focus on providing academic skills, while others think they should also prepare students for their future careers.\n\nDiscuss both views and give your own opinion.\n\nGive reasons for your answer and include any relevant examples from your own knowledge or experience.\n\nWrite at least 250 words.",
  },
  {
    id: "seed_test_writing_gt_t1_complaint",
    questionId: "seed_q_writing_gt_t1_complaint",
    track: "GeneralTraining",
    difficulty: 5,
    type: "writing-task-1-general",
    prompt:
      "You recently bought a piece of equipment for your kitchen but it did not work. You phoned the shop but no action was taken.\n\nWrite a letter to the shop manager. In your letter:\n\n- describe the problem with the equipment\n- explain what happened when you phoned the shop\n- say what you would like the manager to do\n\nWrite at least 150 words.\n\nYou do NOT need to write any addresses.\n\nBegin your letter as follows: Dear Sir or Madam,",
  },
  {
    id: "seed_test_writing_gt_t1_friend",
    questionId: "seed_q_writing_gt_t1_friend",
    track: "GeneralTraining",
    difficulty: 4,
    type: "writing-task-1-general",
    prompt:
      "A friend has agreed to look after your house and pet while you are on holiday.\n\nWrite a letter to your friend. In your letter:\n\n- give contact details for when you are away\n- explain how to care for your pet\n- describe other household duties\n\nWrite at least 150 words.\n\nYou do NOT need to write any addresses.\n\nBegin your letter as follows: Dear ...,",
  },
  {
    id: "seed_test_writing_gt_t2_essay",
    questionId: "seed_q_writing_gt_t2_essay",
    track: "GeneralTraining",
    difficulty: 6,
    type: "writing-task-2",
    prompt:
      "In many countries, people are choosing to live alone rather than with family.\n\nWhat are the reasons for this trend? Do you think it is a positive or negative development?\n\nGive reasons for your answer and include any relevant examples from your own knowledge or experience.\n\nWrite at least 250 words.",
  },
];

async function upsertWritingTask(spec: WritingTaskSpec, approverId: string) {
  await prisma.test.upsert({
    where: { id: spec.id },
    update: {
      track: spec.track,
      section: "Writing",
      difficulty: spec.difficulty,
      status: "Approved",
      approved_by: approverId,
    },
    create: {
      id: spec.id,
      track: spec.track,
      section: "Writing",
      difficulty: spec.difficulty,
      status: "Approved",
      approved_by: approverId,
    },
  });
  // Prisma's nullable JSON column wants `Prisma.JsonNull` for an explicit
  // SQL NULL — not a plain JS null. We always write the column on upsert
  // so re-seeds can both add a visual to an existing task and blank one
  // out by removing it from the spec.
  const visualField: Prisma.InputJsonValue | typeof Prisma.JsonNull = spec.visual
    ? (spec.visual as unknown as Prisma.InputJsonValue)
    : Prisma.JsonNull;
  await prisma.question.upsert({
    where: { id: spec.questionId },
    update: {
      test_id: spec.id,
      type: spec.type,
      prompt: spec.prompt,
      points: 1,
      position: 0,
      visual: visualField,
    },
    create: {
      id: spec.questionId,
      test_id: spec.id,
      type: spec.type,
      prompt: spec.prompt,
      points: 1,
      position: 0,
      visual: visualField,
    },
  });
}

async function main() {
  // The SuperAdmin still needs to live in *some* organization (the schema
  // requires `User.org_id`). Park them inside Org A — `withSuperAdminContext`
  // ignores org membership anyway.
  const orgA = await upsertOrg(ORG_A);
  const orgB = await upsertOrg(ORG_B);

  const superAdmin = await upsertUser({
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

  for (const spec of WRITING_TASKS) {
    await upsertWritingTask(spec, superAdmin.id);
  }

  const userCount = await prisma.user.count();
  const orgCount = await prisma.organization.count({
    where: { id: { in: [orgA.id, orgB.id] } },
  });
  const writingTestCount = await prisma.test.count({
    where: { section: "Writing", status: "Approved" },
  });

  console.log(
    `Seed complete: ${orgCount} demo orgs, ${userCount} users, ` +
      `${writingTestCount} approved Writing tests in DB ` +
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
