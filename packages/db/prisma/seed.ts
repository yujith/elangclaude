// Seed: 1 SuperAdmin + 2 demo orgs (each with 1 OrgAdmin + 2 Learners) +
// a starter pool of approved Writing tests (Academic T1 + T2, GT T1 + T2)
// so the learner UI has real content to drill against on day one.
//
// Idempotent. Re-running is a no-op. Stable IDs make the rows easy to spot in
// `prisma studio` or `psql`.
//
// SAFETY: this runs against whatever DATABASE_URL is set. Seed is wired into
// `prisma db seed` and `prisma migrate dev` — never run it against prod.

import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient, type Track } from "@prisma/client";
import { SYSTEM_ORG_ID, SYSTEM_ORG_NAME } from "../src/system-org";
import { seedClerkIdentities } from "../src/clerk-seed";

// Prisma's CLI loads .env for its own ORM operations, but `process.env`
// access for non-Prisma vars (CLERK_SECRET_KEY, SEED_DEFAULT_PASSWORD,
// SEED_SKIP_CLERK, NODE_ENV) needs an explicit load. Belt + braces.
const seedDir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(seedDir, "../.env") });

const prisma = new PrismaClient();

const SUPER_EMAIL = "super@elanguage.test";

async function upsertSystemOrg() {
  // Singleton parent for SuperAdmin-level ActivityLog rows (content
  // moderation, org CRUD). Status is Archived so it can never accidentally
  // hold real users; the /orgs SuperAdmin list filters this id out.
  return prisma.organization.upsert({
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
  // Dev-only quota — ORG_A houses the SuperAdmin who exercises every
  // generation + approval flow. Approving one Listening test triggers
  // ~55 gateway-counted TTS synth calls; production orgs would never see
  // that profile, so the seed-time quota sits well above prod defaults
  // to keep dev iteration unblocked.
  quota_daily: 2000,
  quota_monthly: 40000,
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

// ─── Subscription plans (ADR-0017 Phase 1) ─────────────────────────────
//
// Canonical Plan catalogue. SuperAdmin can tweak amounts / quotas from
// /plans later, but these are the seed-time defaults. Stable IDs make
// rows easy to spot in prisma studio.
//
// The `internal` plan is the parking spot for existing seeded orgs and
// the system org. Its seat / quota numbers are permissive so backfilled
// orgs that previously had high dev quotas (ORG_A) keep working.
//
// The `free` plan is NOT is_internal — it's a real, customer-facing
// plan with amount=0 and no Stripe sync (ADR-0017 D4). It exists so the
// "Free. Fun. Effective." tagline lands honestly.

type PlanSpec = {
  id: string;
  slug: string;
  name: string;
  description: string;
  seat_limit: number;
  quota_daily: number;
  quota_monthly: number;
  amount_monthly_usd: string;
  trial_days: number;
  is_internal: boolean;
  is_active: boolean;
  sort_order: number;
};

const PLANS: PlanSpec[] = [
  {
    id: "seed_plan_free",
    slug: "free",
    name: "Free",
    description: "Try eLanguage Center with one learner. No card required.",
    seat_limit: 1,
    quota_daily: 50,
    quota_monthly: 300,
    amount_monthly_usd: "0.00",
    trial_days: 0,
    is_internal: false,
    is_active: true,
    sort_order: 10,
  },
  {
    id: "seed_plan_starter",
    slug: "starter",
    name: "Starter",
    description: "For small schools getting started with IELTS prep.",
    seat_limit: 25,
    quota_daily: 50,
    quota_monthly: 1000,
    amount_monthly_usd: "49.00",
    trial_days: 14,
    is_internal: false,
    is_active: true,
    sort_order: 20,
  },
  {
    id: "seed_plan_pro",
    slug: "pro",
    name: "Pro",
    description: "For growing schools and migration agencies.",
    seat_limit: 100,
    quota_daily: 100,
    quota_monthly: 3000,
    amount_monthly_usd: "199.00",
    trial_days: 14,
    is_internal: false,
    is_active: true,
    sort_order: 30,
  },
  {
    id: "seed_plan_enterprise",
    slug: "enterprise",
    name: "Enterprise",
    description: "For universities and national-scale providers.",
    seat_limit: 1000,
    quota_daily: 200,
    quota_monthly: 6000,
    amount_monthly_usd: "799.00",
    trial_days: 14,
    is_internal: false,
    is_active: true,
    sort_order: 40,
  },
  {
    id: "seed_plan_internal",
    slug: "internal",
    name: "Internal",
    description:
      "Non-billed plan for seeded orgs and internal eLanguage Center use.",
    seat_limit: 1000,
    quota_daily: 5000,
    quota_monthly: 100000,
    amount_monthly_usd: "0.00",
    trial_days: 0,
    is_internal: true,
    is_active: true,
    sort_order: 1000,
  },
];

async function upsertPlan(spec: PlanSpec) {
  return prisma.plan.upsert({
    where: { id: spec.id },
    update: {
      slug: spec.slug,
      name: spec.name,
      description: spec.description,
      seat_limit: spec.seat_limit,
      quota_daily: spec.quota_daily,
      quota_monthly: spec.quota_monthly,
      amount_monthly_usd: spec.amount_monthly_usd,
      trial_days: spec.trial_days,
      is_internal: spec.is_internal,
      is_active: spec.is_active,
      sort_order: spec.sort_order,
    },
    create: {
      id: spec.id,
      slug: spec.slug,
      name: spec.name,
      description: spec.description,
      seat_limit: spec.seat_limit,
      quota_daily: spec.quota_daily,
      quota_monthly: spec.quota_monthly,
      amount_monthly_usd: spec.amount_monthly_usd,
      trial_days: spec.trial_days,
      is_internal: spec.is_internal,
      is_active: spec.is_active,
      sort_order: spec.sort_order,
    },
  });
}

// Backfill every existing Org (including the system org) onto the
// `internal` plan with subscription_status=Internal. We deliberately do
// NOT touch seat_limit / quota_daily / quota_monthly on the Org rows —
// those are LIVE values (ORG_A in particular has a tuned high dev
// quota) and overwriting them from the Plan would regress the seed.
// New paying orgs get those copied from the Plan at subscription
// activation time (Phase 4 webhook).
async function backfillOrgsToInternalPlan(internalPlanId: string) {
  await prisma.organization.updateMany({
    where: { plan_id: null },
    data: {
      plan_id: internalPlanId,
      subscription_status: "Internal",
      provisioned_via: "seeded",
    },
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

// ─── Reading ────────────────────────────────────────────────────────────
//
// One hand-seeded Academic Reading passage to populate the learner picker on
// day one and give the deterministic grader a real loop to drill against.
// Shapes mirror packages/ai/src/reading/{passage,question-types}.ts. Stable
// IDs make the rows idempotent across re-runs.

type ReadingParagraphSeed = { label: string; text: string };
type ReadingMatchingGroupSeed = {
  id: string;
  kind: "headings" | "features" | "sentence-endings";
  label?: string;
  items: { key: string; text: string }[];
  allow_reuse?: boolean;
};

type SegmentSeed =
  | { kind: "text"; text: string }
  | { kind: "blank"; slot_id: string };

type CompletionRowSeed = {
  label?: string;
  is_header?: boolean;
  cells: SegmentSeed[][];
};

type CompletionBlockSeed = {
  id: string;
  layout: "summary" | "notes" | "table" | "flow-chart" | "diagram";
  title?: string;
  instructions?: string;
  rows: CompletionRowSeed[];
};

type ReadingPassageSeed = {
  title?: string;
  paragraphs: ReadingParagraphSeed[];
  matching_groups?: ReadingMatchingGroupSeed[];
  completion_blocks?: CompletionBlockSeed[];
  // Optional GT section tag — Phase 7. Academic passages leave this unset.
  gt_context?: "social-survival" | "workplace" | "general-reading";
};

type ReadingQuestionSeed =
  | {
      id: string;
      type: "reading-mcq";
      position: number;
      prompt: string;
      correct_answer: {
        options: { id: string; text: string }[];
        correct: string;
      };
    }
  | {
      id: string;
      type: "reading-true-false-not-given";
      position: number;
      prompt: string;
      correct_answer: { correct: "true" | "false" | "not given" };
    }
  | {
      id: string;
      type: "reading-yes-no-not-given";
      position: number;
      prompt: string;
      correct_answer: { correct: "yes" | "no" | "not given" };
    }
  | {
      id: string;
      type: "reading-sentence-completion";
      position: number;
      prompt: string;
      correct_answer: {
        stem: string;
        word_limit: number;
        accepted: string[];
      };
    }
  | {
      id: string;
      type:
        | "reading-matching-headings"
        | "reading-matching-features"
        | "reading-matching-sentence-endings";
      position: number;
      prompt: string;
      correct_answer: { group_id: string; correct: string };
    }
  | {
      id: string;
      type: "reading-matching-information";
      position: number;
      prompt: string;
      correct_answer: { correct: string };
    }
  | {
      id: string;
      type: "reading-short-answer";
      position: number;
      prompt: string;
      correct_answer: { word_limit: number; accepted: string[] };
    }
  | {
      id: string;
      type: "reading-completion-blank";
      position: number;
      prompt: string;
      correct_answer: {
        block_id: string;
        slot_id: string;
        word_limit: number;
        accepted: string[];
      };
    };

type ReadingTestSpec = {
  id: string;
  track: Track;
  difficulty: number;
  passage: ReadingPassageSeed;
  questions: ReadingQuestionSeed[];
};

const READING_TASKS: ReadingTestSpec[] = [
  // ─── Academic — "A short history of paper" ─────────────────────────────
  {
    id: "seed_test_reading_acad_paper",
    track: "Academic",
    difficulty: 5,
    passage: {
      title: "A short history of paper",
      paragraphs: [
        {
          label: "A",
          text:
            "Long before paper existed, ancient civilisations recorded their ideas on whatever the local landscape provided. The Egyptians cut and pressed strips of papyrus reed; the Mesopotamians pressed wedge-shaped marks into damp clay; the Chinese, before the second century, wrote on strips of bamboo bound together with cord. Each of these materials had drawbacks. Papyrus cracked in dry climates. Clay tablets were unbreakable in fire but heavy to store. Bamboo was abundant but bulky: a single text could occupy a wheelbarrow. The need for something lighter and cheaper was widely felt, but no single innovator emerged for centuries.",
        },
        {
          label: "B",
          text:
            "The breakthrough is traditionally credited to Cai Lun, an official at the imperial court of the Han Dynasty, around 105 CE. According to court records, Cai Lun pulped a mixture of mulberry bark, hemp waste, old rags, and discarded fishing nets, spread the resulting slurry on a fine bamboo screen, and let the water drain away. What remained, once dried, was a thin sheet that could be written on with ink and folded without cracking. The court was impressed enough to grant him a noble title. Modern archaeology has complicated the story — fragments of paper-like sheets predating Cai Lun have been recovered from sites in north-west China — but the technique he documented was the one that spread.",
        },
        {
          label: "C",
          text:
            "For several centuries the recipe stayed within China, where it transformed administration, scholarship, and the spread of Buddhist texts. It travelled outwards slowly. Paper-making is known to have reached Korea by the third century and Japan by the seventh. The decisive moment for the wider world came in 751 CE, when forces of the Abbasid Caliphate captured Chinese soldiers at the Battle of Talas in Central Asia. Among the prisoners, the story goes, were craftsmen who knew the trade. Within a generation, paper mills were operating in Samarkand and Baghdad. From there the craft moved with Islamic scholarship along the Mediterranean.",
        },
        {
          label: "D",
          text:
            "Paper reached Europe by way of Muslim Spain in the eleventh century, but European producers were slow to adopt it. Parchment, made from animal skin, had a long monastic tradition and was felt to be more dignified for sacred texts. Paper was also viewed with suspicion: rulers in several states banned its use for official documents on the grounds that it could be too easily forged. Even after the first European paper mill opened at Fabriano, in Italy, around 1276, paper was largely a commercial material — used for ledgers, letters, and drafts — rather than a vehicle for high culture.",
        },
        {
          label: "E",
          text:
            "Two changes overturned that perception. The first was the gradual improvement of the European mill, which by the early fifteenth century could produce sheets of consistent thickness in volumes that no scriptorium could match. The second was the press. When Johannes Gutenberg began printing Bibles in the 1450s, he needed a material that was uniform, absorbent, and cheap enough to risk in bulk; paper, not parchment, met every requirement. Within fifty years of Gutenberg's first printed page, paper had become the default surface for European writing.",
        },
        {
          label: "F",
          text:
            "The next transformation was industrial. For most of paper's history, the raw material was rag — old linen and cotton clothing, collected by ragmen who walked from door to door. By the eighteenth century, demand from printing was outpacing the supply of rags, and paper-makers began experimenting with alternatives. In 1843 a German weaver, Friedrich Gottlob Keller, demonstrated that wood could be ground into a usable pulp; a decade later, chemical processes were developed that produced stronger, whiter sheets from wood fibre. By 1900, almost all newsprint in the industrialised world was wood-based. The material that Cai Lun pulled from a slurry of bark and rags was, after eighteen centuries, ready for the daily newspaper.",
        },
      ],
    },
    questions: [
      {
        id: "seed_q_reading_acad_paper_1",
        type: "reading-mcq",
        position: 0,
        prompt:
          "According to paragraph A, what was the main practical drawback of bamboo as a writing material?",
        correct_answer: {
          options: [
            { id: "A", text: "It was difficult to source in large quantities." },
            { id: "B", text: "It produced a single bulky volume even for a short text." },
            { id: "C", text: "It could not be written on with ink." },
            { id: "D", text: "It was damaged by fire more easily than clay." },
          ],
          correct: "B",
        },
      },
      {
        id: "seed_q_reading_acad_paper_2",
        type: "reading-true-false-not-given",
        position: 1,
        prompt:
          "Cai Lun is now generally regarded as the sole inventor of paper.\n\nTrue / False / Not Given",
        correct_answer: { correct: "false" },
      },
      {
        id: "seed_q_reading_acad_paper_3",
        type: "reading-true-false-not-given",
        position: 2,
        prompt:
          "Paper-making reached Japan before it reached Korea.\n\nTrue / False / Not Given",
        correct_answer: { correct: "false" },
      },
      {
        id: "seed_q_reading_acad_paper_4",
        type: "reading-true-false-not-given",
        position: 3,
        prompt:
          "The first European paper mill was set up by a craftsman who had been trained in Baghdad.\n\nTrue / False / Not Given",
        correct_answer: { correct: "not given" },
      },
      {
        id: "seed_q_reading_acad_paper_5",
        type: "reading-sentence-completion",
        position: 4,
        prompt:
          "Complete the sentence using NO MORE THAN THREE WORDS from the passage.",
        correct_answer: {
          stem: "Gutenberg's printing process required a writing surface that was uniform, absorbent, and ___.",
          word_limit: 3,
          accepted: ["cheap enough", "cheap"],
        },
      },
      {
        id: "seed_q_reading_acad_paper_6",
        type: "reading-sentence-completion",
        position: 5,
        prompt:
          "Complete the sentence using NO MORE THAN TWO WORDS from the passage.",
        correct_answer: {
          stem: "In 1843, a German weaver showed that ___ could be ground into pulp.",
          word_limit: 2,
          accepted: ["wood"],
        },
      },
    ],
  },

  // ─── Academic — "The case for the car-free centre" (opinion → YNNG) ───
  {
    id: "seed_test_reading_acad_carfree",
    track: "Academic",
    difficulty: 7,
    passage: {
      title: "The case for the car-free centre",
      paragraphs: [
        {
          label: "A",
          text:
            "When the Dutch city of Groningen began closing parts of its centre to private cars in the 1970s, the policy was widely treated as eccentric. Shop owners predicted ruin. Commuters predicted gridlock on the ring road. Newspaper letter pages filled with the usual complaints about social engineers who had never tried to load a week's groceries into a basket. Fifty years on, the argument has been comprehensively settled — and not, in my view, in favour of the cars.",
        },
        {
          label: "B",
          text:
            "The economic case is the easiest to make. Groningen's central retail district has higher footfall, higher rents per square metre, and lower vacancy rates than comparable Dutch cities that kept their through-traffic. The pattern is consistent: when researchers at the University of Amsterdam compared twelve European centres with strict access controls against twelve without, they found average increases of 17 per cent in pedestrian footfall and 12 per cent in retail turnover within three years of restrictions taking effect. Shopkeepers who predicted ruin had, almost without exception, overestimated the share of their customers who arrived by car.",
        },
        {
          label: "C",
          text:
            "The environmental case is just as strong. Removing private vehicles from a square kilometre of dense city removes roughly the carbon equivalent of a small power station. Air-quality monitors in pedestrianised zones consistently record concentrations of nitrogen dioxide and fine particulates well below WHO guideline values, often by a factor of two or three. These are not abstractions. The same studies link them to measurable reductions in childhood asthma admissions in the neighbourhoods immediately downwind.",
        },
        {
          label: "D",
          text:
            "What is less often discussed is the social case. A street given over to moving cars is, almost by definition, a street that people do not linger in. Replace those cars with benches, planters, and outdoor café seating, and the same street becomes a place where strangers exchange a glance and a nod — the basic unit of urban civility. The change is hardest to quantify, but ask any resident of a recently pedestrianised street and the answer is unprompted: the neighbourhood feels safer at night, even though crime statistics rarely change much. Streets become safer because more people are watching them.",
        },
        {
          label: "E",
          text:
            "Critics insist the argument always founders on the same rock: deliveries and accessibility. Both are real concerns, and both, in my view, are routinely overstated. Goods can be — and in well-designed schemes are — delivered in narrow time windows by smaller electric vehicles. Accessibility for residents with reduced mobility is genuinely harder, and the better schemes invest in dedicated drop-off bays, accessible taxis, and door-to-door minibus services. None of this is free, but none of it is, on the evidence, more expensive than the road maintenance, healthcare, and lost productivity that car-dominated streets impose.",
        },
        {
          label: "F",
          text:
            "Where I am less confident is in transplanting the model wholesale. Groningen is compact, flat, and already accustomed to cycling. A car-free policy in a sprawling, hilly North American city would face genuinely different constraints, and the most honest planners say so. But \"different\" is not \"impossible.\" The handful of North American cities that have tried even partial restrictions report the same direction of effect on footfall, rent, and air quality, if not the same magnitude. The evidence is now sufficient, I think, to put the burden of proof firmly on those who would keep the cars.",
        },
      ],
    },
    questions: [
      {
        id: "seed_q_reading_acad_carfree_1",
        type: "reading-mcq",
        position: 0,
        prompt:
          "According to paragraph B, what mistake had shopkeepers in opposition to pedestrianisation typically made?",
        correct_answer: {
          options: [
            { id: "A", text: "They overestimated the share of customers arriving by car." },
            { id: "B", text: "They underestimated the cost of parking enforcement." },
            { id: "C", text: "They failed to notice the decline in footfall during the trial period." },
            { id: "D", text: "They assumed the new restrictions would be reversed within a year." },
          ],
          correct: "A",
        },
      },
      {
        id: "seed_q_reading_acad_carfree_2",
        type: "reading-yes-no-not-given",
        position: 1,
        prompt:
          "The writer thinks the decades-long debate over car-free centres has been settled in favour of restricting cars.\n\nYes / No / Not Given",
        correct_answer: { correct: "yes" },
      },
      {
        id: "seed_q_reading_acad_carfree_3",
        type: "reading-yes-no-not-given",
        position: 2,
        prompt:
          "The writer believes concerns about deliveries are reasonable and have not been properly addressed.\n\nYes / No / Not Given",
        correct_answer: { correct: "no" },
      },
      {
        id: "seed_q_reading_acad_carfree_4",
        type: "reading-yes-no-not-given",
        position: 3,
        prompt:
          "The writer is sure that the Groningen model would not work in any North American city.\n\nYes / No / Not Given",
        correct_answer: { correct: "no" },
      },
      {
        id: "seed_q_reading_acad_carfree_5",
        type: "reading-true-false-not-given",
        position: 4,
        prompt:
          "Pedestrianised streets in the studies cited had lower crime statistics than comparable streets that allowed cars.\n\nTrue / False / Not Given",
        correct_answer: { correct: "not given" },
      },
      {
        id: "seed_q_reading_acad_carfree_6",
        type: "reading-sentence-completion",
        position: 5,
        prompt:
          "Complete the sentence using NO MORE THAN TWO WORDS from the passage.",
        correct_answer: {
          stem: "Researchers at the University of Amsterdam found a 17 per cent rise in ___ within three years of restrictions taking effect.",
          word_limit: 2,
          accepted: ["pedestrian footfall", "footfall"],
        },
      },
    ],
  },

  // ─── General Training — "Office relocation FAQ" ────────────────────────
  {
    id: "seed_test_reading_gt_relocation",
    track: "GeneralTraining",
    difficulty: 4,
    passage: {
      title: "Moving to the new King Street office — staff FAQ",
      gt_context: "workplace",
      paragraphs: [
        {
          label: "A",
          text:
            "Our move from the Albany Road site to the new King Street building is scheduled for the weekend of 27–28 June. Most of you have already heard the date informally, but this note sets out the practical details. Please read it carefully — there are a number of small changes that affect everyone and one or two that affect only specific teams.",
        },
        {
          label: "B",
          text:
            "On Friday 26 June, the office will close at 1 p.m. so that the removal company can begin packing non-essential items. You are responsible for your own personal possessions and any items on or under your desk. A roll of labels and a marker pen will be left on every desk by lunchtime: please label boxes with your name and your new team location (these are listed on the floor plan circulated last week). Anything left unlabelled may not arrive on Monday.",
        },
        {
          label: "C",
          text:
            "Computers will be moved by the IT team, not the removal company. Please log out, shut down your machine, and leave the keyboard and mouse on top of the tower or laptop. Do not pack cables, monitors, or docking stations yourself — they will be re-issued from a central store at the new building. Personal phones and tablets must be taken home with you on Friday.",
        },
        {
          label: "D",
          text:
            "The new office uses a permit-based parking system. There is no on-site car park, but the King Street multi-storey is two minutes' walk away and offers a monthly permit at the staff rate of £85. Forms are with HR. If you currently cycle to work, the new building has secure indoor cycle racks at street level and showers on the second floor — keys are issued by Facilities. Bus routes 17, 22 and 44 stop within five minutes' walk; the train station is ten minutes on foot.",
        },
        {
          label: "E",
          text:
            "Finally, the canteen at King Street is operated by an external caterer and is open from 7.30 a.m. to 3 p.m., Monday to Friday. Breakfast, lunch, and a smaller hot-food service from 2 p.m. are available. The kitchenettes on each floor will continue to provide tea, coffee, and a fridge for personal items, as they did at Albany Road. There is no vending machine on site, so if you rely on one, please plan accordingly.",
        },
      ],
    },
    questions: [
      {
        id: "seed_q_reading_gt_relocation_1",
        type: "reading-mcq",
        position: 0,
        prompt:
          "What time does the Albany Road office close on Friday 26 June?",
        correct_answer: {
          options: [
            { id: "A", text: "12 noon." },
            { id: "B", text: "1 p.m." },
            { id: "C", text: "3 p.m." },
            { id: "D", text: "At the end of the normal working day." },
          ],
          correct: "B",
        },
      },
      {
        id: "seed_q_reading_gt_relocation_2",
        type: "reading-true-false-not-given",
        position: 1,
        prompt:
          "Boxes that are not labelled with a name and team may fail to arrive at the new office on Monday.\n\nTrue / False / Not Given",
        correct_answer: { correct: "true" },
      },
      {
        id: "seed_q_reading_gt_relocation_3",
        type: "reading-true-false-not-given",
        position: 2,
        prompt:
          "Staff are expected to disconnect and pack their own computer cables before the move.\n\nTrue / False / Not Given",
        correct_answer: { correct: "false" },
      },
      {
        id: "seed_q_reading_gt_relocation_4",
        type: "reading-true-false-not-given",
        position: 3,
        prompt:
          "The new office has an on-site car park reserved for senior staff.\n\nTrue / False / Not Given",
        correct_answer: { correct: "false" },
      },
      {
        id: "seed_q_reading_gt_relocation_5",
        type: "reading-sentence-completion",
        position: 4,
        prompt:
          "Complete the sentence using NO MORE THAN TWO WORDS AND/OR A NUMBER from the passage.",
        correct_answer: {
          stem: "A monthly parking permit at the King Street multi-storey costs ___ at the staff rate.",
          word_limit: 2,
          accepted: ["£85"],
        },
      },
      {
        id: "seed_q_reading_gt_relocation_6",
        type: "reading-sentence-completion",
        position: 5,
        prompt:
          "Complete the sentence using NO MORE THAN THREE WORDS from the passage.",
        correct_answer: {
          stem: "Showers for cyclists are located on the ___ of the new building.",
          word_limit: 3,
          accepted: ["second floor"],
        },
      },
    ],
  },

  // ─── Academic — "The honey bee and the orchard" (matching-headings +
  //                  matching-information heavy) ──────────────────────────
  {
    id: "seed_test_reading_acad_bees",
    track: "Academic",
    difficulty: 6,
    passage: {
      title: "The honey bee and the orchard",
      matching_groups: [
        {
          id: "bees-headings",
          kind: "headings",
          label: "List of headings",
          items: [
            { key: "i", text: "A surprising scale of dependency" },
            { key: "ii", text: "An unexpected economic case" },
            { key: "iii", text: "Why a single species is not enough" },
            { key: "iv", text: "Mites, viruses, and chemical stress" },
            { key: "v", text: "Lessons from a Sichuan valley" },
            { key: "vi", text: "Restoring habitat from the orchard edge" },
            { key: "vii", text: "What the next decade demands" },
            { key: "viii", text: "The mistake of treating bees as livestock" },
          ],
        },
      ],
      paragraphs: [
        {
          label: "A",
          text:
            "It is easy to forget how much of the food on a supermarket shelf depends on insects. Of the hundred or so crops that supply roughly 90 per cent of the world's diet, around three-quarters benefit, to some measurable degree, from animal pollination. Apples, pears, almonds, blueberries, oilseed rape, coffee, and cocoa all yield more — sometimes much more — when bees are abundant. Translate that into money and the figures become hard to ignore: a 2016 IPBES assessment put the annual contribution of pollinators to global crop output at between US$235 and US$577 billion.",
        },
        {
          label: "B",
          text:
            "For most of the twentieth century the orchard industry's answer to this dependency was simple. Bring in honey bees. The European honey bee, Apis mellifera, was bred and trucked across continents in numbers that no other pollinator could match. A modern California almond grower may host three honey bee colonies per hectare during bloom, in a managed migration that involves more than two million hives every February. The model worked — until it began to falter.",
        },
        {
          label: "C",
          text:
            "The visible faltering began in 2006, when American beekeepers reported losing 30 to 90 per cent of their colonies over a single winter. The phenomenon was named Colony Collapse Disorder. The underlying causes turned out to be plural rather than singular. Varroa destructor, a mite that feeds on bee brood and transmits viral diseases, was the most direct stressor. But behind the mite was an interacting web of poor nutrition from monoculture forage, sublethal exposure to neonicotinoid insecticides, and the stress of long-distance transport itself.",
        },
        {
          label: "D",
          text:
            "Equally important — and slower to be accepted — was that the honey bee, for all its commercial usefulness, is not the most effective pollinator of every crop. Pumpkins are pollinated more efficiently by squash bees; alfalfa by leafcutter bees; cranberries by bumblebees. A field that hosts only honey bees may produce a respectable yield, but a field that hosts a community of wild and managed pollinators consistently produces more. The implication is that the orchard industry's monoculture-of-pollinator approach was, in the long run, working against itself.",
        },
        {
          label: "E",
          text:
            "Some of the strongest empirical evidence for that conclusion comes from an unlikely place: an apple-growing valley in south-western China. Hand-pollination of apple flowers became routine there in the 1980s after local pollinator populations collapsed under heavy pesticide use, and the practice persists today. The labour cost is staggering — by some estimates, two or three times the cost of buying bees in. The Sichuan example is now cited in farm-extension training the world over as a warning of what an orchard economy looks like when its wild pollinators are gone.",
        },
        {
          label: "F",
          text:
            "What is needed, the present consensus runs, is to manage orchards as ecosystems rather than as factories that import their pollination services. Strips of wildflower habitat along orchard margins, late-blooming cover crops between rows, drastically reduced spraying during bloom, and the planting of hedgerows that overwinter wild bees have all been shown to raise both wild-pollinator abundance and crop yield within three to five years. None of these measures is novel; the change is that growers and government agencies are now willing to pay for them.",
        },
      ],
    },
    questions: [
      {
        id: "seed_q_reading_acad_bees_1",
        type: "reading-matching-headings",
        position: 0,
        prompt: "Choose the most suitable heading for Paragraph A from the list of headings.",
        correct_answer: { group_id: "bees-headings", correct: "i" },
      },
      {
        id: "seed_q_reading_acad_bees_2",
        type: "reading-matching-headings",
        position: 1,
        prompt: "Choose the most suitable heading for Paragraph C.",
        correct_answer: { group_id: "bees-headings", correct: "iv" },
      },
      {
        id: "seed_q_reading_acad_bees_3",
        type: "reading-matching-headings",
        position: 2,
        prompt: "Choose the most suitable heading for Paragraph D.",
        correct_answer: { group_id: "bees-headings", correct: "iii" },
      },
      {
        id: "seed_q_reading_acad_bees_4",
        type: "reading-matching-headings",
        position: 3,
        prompt: "Choose the most suitable heading for Paragraph E.",
        correct_answer: { group_id: "bees-headings", correct: "v" },
      },
      {
        id: "seed_q_reading_acad_bees_5",
        type: "reading-matching-information",
        position: 4,
        prompt:
          "Which paragraph contains a specific monetary estimate of the value of pollination services?",
        correct_answer: { correct: "A" },
      },
      {
        id: "seed_q_reading_acad_bees_6",
        type: "reading-matching-information",
        position: 5,
        prompt:
          "Which paragraph mentions a country where farmers pollinate fruit trees by hand?",
        correct_answer: { correct: "E" },
      },
      {
        id: "seed_q_reading_acad_bees_7",
        type: "reading-sentence-completion",
        position: 6,
        prompt: "Complete the sentence using NO MORE THAN TWO WORDS from the passage.",
        correct_answer: {
          stem: "Around three-quarters of the crops that supply most of the world's diet benefit from ___ pollination.",
          word_limit: 2,
          accepted: ["animal"],
        },
      },
    ],
  },

  // ─── General Training — "Renting your first flat" (consumer guide) ─────
  {
    id: "seed_test_reading_gt_renting",
    track: "GeneralTraining",
    difficulty: 5,
    passage: {
      title: "Renting your first flat — a guide for newcomers",
      gt_context: "social-survival",
      paragraphs: [
        {
          label: "A",
          text:
            "Most newcomers are surprised by how quickly the rental market moves. A flat that is advertised on a Monday morning may already have three viewings booked by lunchtime. Before you start arranging viewings, decide what you can actually afford. The widely-used rule of thumb is that rent should not exceed one-third of your monthly take-home pay; council tax, water, energy, and internet usually add a further 15–20 per cent on top.",
        },
        {
          label: "B",
          text:
            "Once you have a budget, register with two or three letting agents in the area you are interested in. Most agents will email you new listings the day they go live, which is much faster than scrolling property portals yourself. When you contact an agent, be ready to confirm three things in writing: your employer, your gross annual salary, and the date you want to move. Without these, agents will rarely arrange a viewing.",
        },
        {
          label: "C",
          text:
            "At the viewing itself, take photographs of any visible damage and ask about three less obvious things: the EPC (energy performance) rating, the water pressure in the shower, and the broadband speed at the address. A flat that looks bright on a sunny afternoon can be expensive to heat in February if the EPC rating is below D. Estate agents are required by law to share the EPC certificate on request.",
        },
        {
          label: "D",
          text:
            "If you decide to apply, you will normally be asked for a holding deposit equal to one week's rent. By law this can be held for no more than fifteen days while references are checked, and it must be returned in full if the landlord later decides not to proceed. The full deposit (commonly five weeks' rent) is payable only when you sign the tenancy agreement. It must be placed in a government-approved deposit protection scheme within thirty days, and the landlord must give you the scheme details in writing.",
        },
        {
          label: "E",
          text:
            "Finally, do not sign the tenancy agreement on the day of the viewing, however much pressure the agent applies. Take it home, read it overnight, and pay particular attention to the clauses on notice periods, redecoration, and any \"break clauses\" that allow either side to end the tenancy early. If anything is unclear, the local Citizens Advice office offers a free thirty-minute review for tenants who bring a draft contract. Use it. A tenancy is a year-long commitment; an afternoon spent checking the small print is cheap insurance.",
        },
      ],
    },
    questions: [
      {
        id: "seed_q_reading_gt_renting_1",
        type: "reading-mcq",
        position: 0,
        prompt:
          "According to paragraph A, what proportion of monthly take-home pay does the writer suggest rent should not exceed?",
        correct_answer: {
          options: [
            { id: "A", text: "One-quarter." },
            { id: "B", text: "One-third." },
            { id: "C", text: "One-half." },
            { id: "D", text: "Two-thirds." },
          ],
          correct: "B",
        },
      },
      {
        id: "seed_q_reading_gt_renting_2",
        type: "reading-true-false-not-given",
        position: 1,
        prompt:
          "Letting agents typically email new listings to registered applicants on the same day the listings appear.\n\nTrue / False / Not Given",
        correct_answer: { correct: "true" },
      },
      {
        id: "seed_q_reading_gt_renting_3",
        type: "reading-true-false-not-given",
        position: 2,
        prompt:
          "Estate agents may legally refuse to share the EPC certificate before a tenancy is signed.\n\nTrue / False / Not Given",
        correct_answer: { correct: "false" },
      },
      {
        id: "seed_q_reading_gt_renting_4",
        type: "reading-true-false-not-given",
        position: 3,
        prompt:
          "The author has personally used the Citizens Advice tenancy review service.\n\nTrue / False / Not Given",
        correct_answer: { correct: "not given" },
      },
      {
        id: "seed_q_reading_gt_renting_5",
        type: "reading-sentence-completion",
        position: 4,
        prompt:
          "Complete the sentence using NO MORE THAN THREE WORDS from the passage.",
        correct_answer: {
          stem: "The holding deposit is usually equal to ___ of rent.",
          word_limit: 3,
          accepted: ["one week", "one week's", "a week"],
        },
      },
      {
        id: "seed_q_reading_gt_renting_6",
        type: "reading-sentence-completion",
        position: 5,
        prompt:
          "Complete the sentence using NO MORE THAN TWO WORDS AND/OR A NUMBER from the passage.",
        correct_answer: {
          stem: "Your full deposit must be placed in a protection scheme within ___ days.",
          word_limit: 2,
          accepted: ["thirty", "30"],
        },
      },
    ],
  },

  // ─── Academic — "Reading the deep ocean floor" (matching-features +
  //                  matching-sentence-endings heavy) ──────────────────────
  {
    id: "seed_test_reading_acad_oceanfloor",
    track: "Academic",
    difficulty: 7,
    passage: {
      title: "Reading the deep ocean floor",
      matching_groups: [
        {
          id: "ocean-voices",
          kind: "features",
          label: "List of researchers",
          items: [
            { key: "MM", text: "Marie Tharp, mid-twentieth-century cartographer" },
            { key: "BH", text: "Bruce Heezen, marine geophysicist" },
            { key: "SR", text: "Suzanne Roden, post-1990 sediment-core geochemist" },
            { key: "DS", text: "Donovan Shipley, current head of GEBCO's Seabed 2030" },
          ],
          allow_reuse: false,
        },
        {
          id: "ocean-endings",
          kind: "sentence-endings",
          label: "Sentence endings",
          items: [
            { key: "A", text: "could now be measured to within a few centimetres." },
            { key: "B", text: "was treated as unbelievable by senior colleagues." },
            { key: "C", text: "remained almost entirely unexplored." },
            { key: "D", text: "was driven by the demand for telegraph-cable routes." },
            { key: "E", text: "produced the first global bathymetric chart used by oil companies." },
            { key: "F", text: "doubled the area of seabed mapped at high resolution within seven years." },
          ],
        },
      ],
      paragraphs: [
        {
          label: "A",
          text:
            "For most of human history, the floor of the deep ocean was less well known than the surface of the Moon. Even in the 1950s, when commercial flights were crossing the Atlantic daily, the great basin a few kilometres beneath those flights remained almost entirely unexplored. Soundings had been taken since the nineteenth century, originally to plan telegraph cables, but the data were sparse, irregular, and rarely cross-referenced. The first picture of what was actually down there emerged not from a submarine expedition, but from a desk in a New York lab.",
        },
        {
          label: "B",
          text:
            "That desk belonged to Marie Tharp, a geologist who had been forbidden, on the grounds of her sex, from joining her department's research vessels in the 1940s and 1950s. Confined to onshore work, Tharp began plotting the ship-board echo-sounding profiles that her colleagues sent back. As she traced the data across blank ocean maps, she noticed a sharp valley running down the centre of the Mid-Atlantic Ridge. She concluded that the valley was a rift — the floor of the ocean was being pulled apart. When she told Bruce Heezen, the lab's chief marine geophysicist, he reportedly called the suggestion 'girl talk' and dismissed it. Within five years his own data forced him to change his mind, and Tharp's interpretation became one of the founding observations of plate tectonics.",
        },
        {
          label: "C",
          text:
            "Heezen's role in the story is more complicated than the dismissal makes it sound. Once persuaded, he co-authored with Tharp the painted relief maps that became the iconic image of the ocean floor in textbooks for two generations. Heezen's particular contribution was matching their bathymetry against the earthquake belts then being catalogued in the late 1950s — a comparison that established that the mid-ocean ridges were seismically active and therefore most likely the sites of new crust being formed. Without Heezen's seismic correlation, Tharp's rift might have remained a striking feature on a map; with it, the two researchers together produced the first global bathymetric chart adopted by exploration geologists at the major oil companies.",
        },
        {
          label: "D",
          text:
            "The next generation of advance came not from cartography but from chemistry. By the late 1990s, Suzanne Roden and her group at Woods Hole had begun using sediment cores from the seafloor to reconstruct ocean circulation patterns over the last 800,000 years. The cores produced isotopic signatures that, once correlated with each other, allowed climate-modellers to fix the depth of past temperature shifts to within a few centimetres on the sea-floor — an extraordinary level of resolution given that the cores were taken five kilometres below the surface.",
        },
        {
          label: "E",
          text:
            "Today the work continues at a scale that would have stunned Tharp and Heezen. Donovan Shipley directs the international Seabed 2030 project, which aims to produce a complete bathymetric map of the world's ocean floor by the end of this decade. Combining multi-beam sonar from research vessels with crowd-sourced soundings from merchant ships, the project has doubled the area of seabed mapped at high resolution between 2017 and 2024, and now covers roughly a quarter of the planet's oceans at sub-kilometre detail. The hope is not only scientific. Detailed bathymetry feeds the placement of tsunami sensors, the routing of submarine fibre-optic cables, and — increasingly — the contested licensing of deep-sea mining.",
        },
      ],
    },
    questions: [
      {
        id: "seed_q_reading_acad_oceanfloor_1",
        type: "reading-matching-features",
        position: 0,
        prompt:
          "Identified a central valley along the Mid-Atlantic Ridge that turned out to be a tectonic rift.",
        correct_answer: { group_id: "ocean-voices", correct: "MM" },
      },
      {
        id: "seed_q_reading_acad_oceanfloor_2",
        type: "reading-matching-features",
        position: 1,
        prompt:
          "Established that the mid-ocean ridges coincided with belts of earthquake activity.",
        correct_answer: { group_id: "ocean-voices", correct: "BH" },
      },
      {
        id: "seed_q_reading_acad_oceanfloor_3",
        type: "reading-matching-features",
        position: 2,
        prompt:
          "Directs an international effort to map the entire ocean floor by the end of the 2020s.",
        correct_answer: { group_id: "ocean-voices", correct: "DS" },
      },
      {
        id: "seed_q_reading_acad_oceanfloor_4",
        type: "reading-matching-features",
        position: 3,
        prompt:
          "Reconstructed past ocean temperatures from seafloor sediment cores.",
        correct_answer: { group_id: "ocean-voices", correct: "SR" },
      },
      {
        id: "seed_q_reading_acad_oceanfloor_5",
        type: "reading-matching-sentence-endings",
        position: 4,
        prompt: "In the 1950s, the deep Atlantic basin",
        correct_answer: { group_id: "ocean-endings", correct: "C" },
      },
      {
        id: "seed_q_reading_acad_oceanfloor_6",
        type: "reading-matching-sentence-endings",
        position: 5,
        prompt: "Tharp's interpretation of the central valley as a rift",
        correct_answer: { group_id: "ocean-endings", correct: "B" },
      },
      {
        id: "seed_q_reading_acad_oceanfloor_7",
        type: "reading-matching-sentence-endings",
        position: 6,
        prompt:
          "Combining multi-beam sonar with merchant-ship soundings",
        correct_answer: { group_id: "ocean-endings", correct: "F" },
      },
    ],
  },

  // ─── Academic — "How a passive solar house works" (completion + short-
  //                  answer coverage for Phase 4) ───────────────────────
  {
    id: "seed_test_reading_acad_passivesolar",
    track: "Academic",
    difficulty: 6,
    passage: {
      title: "How a passive solar house works",
      paragraphs: [
        {
          label: "A",
          text:
            "A passive solar house heats itself with sunlight. Unlike an active system, which uses pumps and fans, a passive design relies on the building's own shape and materials to capture solar energy during the day and release it slowly at night. Four functions have to be performed in sequence: the sun's heat must be collected, stored, distributed around the rooms, and regulated so that the house never gets uncomfortably hot or cold.",
        },
        {
          label: "B",
          text:
            "Collection is the job of south-facing glazing. In the northern hemisphere, the equator-facing wall of a passive house carries an unusual amount of window area — typically 7 to 12 per cent of the heated floor area. The glazing is usually double- or triple-pane with a low-emissivity coating, which lets short-wave sunlight in but reflects long-wave infrared back into the room.",
        },
        {
          label: "C",
          text:
            "Storage is the job of thermal mass — dense materials inside the insulation envelope that absorb the captured heat and release it gradually. Concrete, brick, stone, and water all work; wood does not, because its density is too low. A common rule of thumb is that for every square metre of south-facing glass, five to seven square metres of exposed thermal mass are required. Without enough mass, the room overheats by noon and is cold by 4 a.m.",
        },
        {
          label: "D",
          text:
            "Distribution is the job of the floor plan. Heat flows naturally from warm rooms to cool ones if the plan allows it; long thin houses oriented east-west with open transitions between rooms outperform compact square plans. Where a closed door blocks heat, a transom panel above the door — or, in two-storey houses, a stairwell open at the top — restores the flow.",
        },
        {
          label: "E",
          text:
            "Regulation is the job of shading. In summer, the same sun that warms the house in February overheats it in July. A well-designed overhang above the south-facing glazing is sized so that it shades the window in summer and admits sunlight in winter. The geometry is fixed by latitude; once the angle is right, no moving parts are needed.",
        },
        {
          label: "F",
          text:
            "The technique itself is not new. The Greek philosopher Socrates is said to have described a solar house in the fifth century BCE, and the American physicist Edward Morse patented a solar wall in 1881 that exploited the same physics. What has changed is the building stock. Insulation values, air-tightness, and glazing performance have improved by orders of magnitude since the 1970s, and a modern passive solar house in a temperate climate can run on roughly a tenth of the heating energy of a typical building of the same floor area.",
        },
      ],
      completion_blocks: [
        // ─── Summary completion ────────────────────────────────────────
        {
          id: "passive-summary",
          layout: "summary",
          title: "Summary",
          instructions: "Complete the summary with NO MORE THAN TWO WORDS for each blank.",
          rows: [
            {
              cells: [
                [
                  {
                    kind: "text",
                    text: "Passive solar houses are not a new idea. The Greek philosopher ",
                  },
                  { kind: "blank", slot_id: "passive-summary.greek" },
                  {
                    kind: "text",
                    text:
                      " is said to have described one as early as the fifth century BCE. In the United States, the physicist Edward Morse patented an early solar wall in the year ",
                  },
                  { kind: "blank", slot_id: "passive-summary.year" },
                  {
                    kind: "text",
                    text:
                      ". What is new is the building envelope: since the 1970s, the heating energy required by a modern passive solar house has fallen to roughly ",
                  },
                  { kind: "blank", slot_id: "passive-summary.fraction" },
                  {
                    kind: "text",
                    text:
                      " of that of a comparable conventional building.",
                  },
                ],
              ],
            },
          ],
        },
        // ─── Notes completion ─────────────────────────────────────────
        {
          id: "passive-notes",
          layout: "notes",
          title: "Notes on the four functions of a passive solar design",
          instructions:
            "Complete the notes with NO MORE THAN TWO WORDS for each blank.",
          rows: [
            {
              label: "Collection:",
              cells: [
                [
                  { kind: "text", text: "south-facing " },
                  { kind: "blank", slot_id: "passive-notes.collection" },
                  {
                    kind: "text",
                    text:
                      ", typically 7–12% of the heated floor area, with a low-emissivity coating.",
                  },
                ],
              ],
            },
            {
              label: "Storage:",
              cells: [
                [
                  {
                    kind: "text",
                    text:
                      "dense materials inside the insulation envelope — concrete, brick, stone, water. ",
                  },
                  { kind: "blank", slot_id: "passive-notes.storage" },
                  {
                    kind: "text",
                    text: " is not suitable because its density is too low.",
                  },
                ],
              ],
            },
            {
              label: "Distribution:",
              cells: [
                [
                  { kind: "text", text: "long thin floor plans oriented " },
                  { kind: "blank", slot_id: "passive-notes.orientation" },
                  {
                    kind: "text",
                    text: " outperform compact square plans.",
                  },
                ],
              ],
            },
          ],
        },
        // ─── Table completion ─────────────────────────────────────────
        {
          id: "passive-table",
          layout: "table",
          title: "Glazing rules of thumb",
          instructions: "Complete the table with NO MORE THAN TWO WORDS for each blank.",
          rows: [
            {
              is_header: true,
              cells: [
                [{ kind: "text", text: "Function" }],
                [{ kind: "text", text: "Component" }],
                [{ kind: "text", text: "Key figure" }],
              ],
            },
            {
              cells: [
                [{ kind: "text", text: "Collection" }],
                [{ kind: "text", text: "South-facing glazing" }],
                [
                  { kind: "text", text: "7 to " },
                  { kind: "blank", slot_id: "passive-table.collection-pct" },
                  { kind: "text", text: "% of heated floor area" },
                ],
              ],
            },
            {
              cells: [
                [{ kind: "text", text: "Storage" }],
                [{ kind: "text", text: "Thermal mass" }],
                [
                  { kind: "text", text: "5 to " },
                  { kind: "blank", slot_id: "passive-table.mass-ratio" },
                  {
                    kind: "text",
                    text:
                      " m² of exposed mass per m² of south-facing glass",
                  },
                ],
              ],
            },
            {
              cells: [
                [{ kind: "text", text: "Regulation" }],
                [
                  { kind: "blank", slot_id: "passive-table.regulator" },
                  {
                    kind: "text",
                    text: " above south-facing glazing",
                  },
                ],
                [
                  {
                    kind: "text",
                    text: "geometry fixed by the building's latitude",
                  },
                ],
              ],
            },
          ],
        },
        // ─── Flow-chart completion ────────────────────────────────────
        {
          id: "passive-flow",
          layout: "flow-chart",
          title: "How heat moves through a passive solar house",
          instructions: "Complete the flow-chart with ONE WORD for each blank.",
          rows: [
            {
              label: "1",
              cells: [
                [
                  { kind: "text", text: "Daytime sunlight passes through " },
                  { kind: "blank", slot_id: "passive-flow.glazing" },
                  { kind: "text", text: " on the south-facing wall." },
                ],
              ],
            },
            {
              label: "2",
              cells: [
                [
                  { kind: "text", text: "Light strikes the " },
                  { kind: "blank", slot_id: "passive-flow.mass" },
                  {
                    kind: "text",
                    text:
                      " inside the insulation envelope and is absorbed.",
                  },
                ],
              ],
            },
            {
              label: "3",
              cells: [
                [
                  {
                    kind: "text",
                    text: "Heat is released slowly into the room overnight.",
                  },
                ],
              ],
            },
            {
              label: "4",
              cells: [
                [
                  {
                    kind: "text",
                    text: "Heat moves between rooms through open transitions, transoms, or an open ",
                  },
                  { kind: "blank", slot_id: "passive-flow.stair" },
                  { kind: "text", text: " in two-storey homes." },
                ],
              ],
            },
          ],
        },
        // ─── Diagram-label completion ────────────────────────────────
        {
          id: "passive-diagram",
          layout: "diagram",
          title: "Labelled cross-section of a south-facing wall",
          instructions:
            "Label the diagram with NO MORE THAN TWO WORDS for each blank.",
          rows: [
            {
              label: "Top callout:",
              cells: [
                [
                  { kind: "text", text: "Roof " },
                  { kind: "blank", slot_id: "passive-diagram.overhang" },
                  {
                    kind: "text",
                    text:
                      " sized to shade the window in July and admit sun in February.",
                  },
                ],
              ],
            },
            {
              label: "Wall callout:",
              cells: [
                [
                  { kind: "text", text: "Double-pane " },
                  { kind: "blank", slot_id: "passive-diagram.window" },
                  {
                    kind: "text",
                    text:
                      " with a low-emissivity coating on the inner pane.",
                  },
                ],
              ],
            },
            {
              label: "Floor callout:",
              cells: [
                [
                  { kind: "text", text: "Concrete " },
                  { kind: "blank", slot_id: "passive-diagram.slab" },
                  {
                    kind: "text",
                    text:
                      " inside the insulation envelope, acting as the thermal mass.",
                  },
                ],
              ],
            },
          ],
        },
      ],
    },
    questions: [
      // Summary block — three blanks
      {
        id: "seed_q_reading_acad_passivesolar_1",
        type: "reading-completion-blank",
        position: 0,
        prompt: "Summary — first blank",
        correct_answer: {
          block_id: "passive-summary",
          slot_id: "passive-summary.greek",
          word_limit: 2,
          accepted: ["socrates"],
        },
      },
      {
        id: "seed_q_reading_acad_passivesolar_2",
        type: "reading-completion-blank",
        position: 1,
        prompt: "Summary — second blank",
        correct_answer: {
          block_id: "passive-summary",
          slot_id: "passive-summary.year",
          word_limit: 1,
          accepted: ["1881"],
        },
      },
      {
        id: "seed_q_reading_acad_passivesolar_3",
        type: "reading-completion-blank",
        position: 2,
        prompt: "Summary — third blank",
        correct_answer: {
          block_id: "passive-summary",
          slot_id: "passive-summary.fraction",
          word_limit: 2,
          accepted: ["a tenth", "one tenth"],
        },
      },
      // Notes block — three blanks
      {
        id: "seed_q_reading_acad_passivesolar_4",
        type: "reading-completion-blank",
        position: 3,
        prompt: "Notes — collection",
        correct_answer: {
          block_id: "passive-notes",
          slot_id: "passive-notes.collection",
          word_limit: 1,
          accepted: ["glazing", "windows"],
        },
      },
      {
        id: "seed_q_reading_acad_passivesolar_5",
        type: "reading-completion-blank",
        position: 4,
        prompt: "Notes — storage",
        correct_answer: {
          block_id: "passive-notes",
          slot_id: "passive-notes.storage",
          word_limit: 1,
          accepted: ["wood"],
        },
      },
      {
        id: "seed_q_reading_acad_passivesolar_6",
        type: "reading-completion-blank",
        position: 5,
        prompt: "Notes — distribution",
        correct_answer: {
          block_id: "passive-notes",
          slot_id: "passive-notes.orientation",
          word_limit: 1,
          accepted: ["east-west"],
        },
      },
      // Table block — three blanks
      {
        id: "seed_q_reading_acad_passivesolar_7",
        type: "reading-completion-blank",
        position: 6,
        prompt: "Table — collection percentage",
        correct_answer: {
          block_id: "passive-table",
          slot_id: "passive-table.collection-pct",
          word_limit: 1,
          accepted: ["12"],
        },
      },
      {
        id: "seed_q_reading_acad_passivesolar_8",
        type: "reading-completion-blank",
        position: 7,
        prompt: "Table — mass ratio",
        correct_answer: {
          block_id: "passive-table",
          slot_id: "passive-table.mass-ratio",
          word_limit: 1,
          accepted: ["7", "seven"],
        },
      },
      {
        id: "seed_q_reading_acad_passivesolar_9",
        type: "reading-completion-blank",
        position: 8,
        prompt: "Table — regulator",
        correct_answer: {
          block_id: "passive-table",
          slot_id: "passive-table.regulator",
          word_limit: 1,
          accepted: ["overhang"],
        },
      },
      // Flow-chart block — three blanks
      {
        id: "seed_q_reading_acad_passivesolar_10",
        type: "reading-completion-blank",
        position: 9,
        prompt: "Flow-chart — step 1",
        correct_answer: {
          block_id: "passive-flow",
          slot_id: "passive-flow.glazing",
          word_limit: 1,
          accepted: ["glazing", "windows"],
        },
      },
      {
        id: "seed_q_reading_acad_passivesolar_11",
        type: "reading-completion-blank",
        position: 10,
        prompt: "Flow-chart — step 2",
        correct_answer: {
          block_id: "passive-flow",
          slot_id: "passive-flow.mass",
          word_limit: 1,
          accepted: ["mass"],
        },
      },
      {
        id: "seed_q_reading_acad_passivesolar_12",
        type: "reading-completion-blank",
        position: 11,
        prompt: "Flow-chart — step 4",
        correct_answer: {
          block_id: "passive-flow",
          slot_id: "passive-flow.stair",
          word_limit: 1,
          accepted: ["stairwell"],
        },
      },
      // Diagram block — three blanks
      {
        id: "seed_q_reading_acad_passivesolar_13",
        type: "reading-completion-blank",
        position: 12,
        prompt: "Diagram — roof callout",
        correct_answer: {
          block_id: "passive-diagram",
          slot_id: "passive-diagram.overhang",
          word_limit: 1,
          accepted: ["overhang"],
        },
      },
      {
        id: "seed_q_reading_acad_passivesolar_14",
        type: "reading-completion-blank",
        position: 13,
        prompt: "Diagram — wall callout",
        correct_answer: {
          block_id: "passive-diagram",
          slot_id: "passive-diagram.window",
          word_limit: 1,
          accepted: ["glazing", "windows", "window"],
        },
      },
      {
        id: "seed_q_reading_acad_passivesolar_15",
        type: "reading-completion-blank",
        position: 14,
        prompt: "Diagram — floor callout",
        correct_answer: {
          block_id: "passive-diagram",
          slot_id: "passive-diagram.slab",
          word_limit: 1,
          accepted: ["slab"],
        },
      },
      // Short-answer
      {
        id: "seed_q_reading_acad_passivesolar_16",
        type: "reading-short-answer",
        position: 15,
        prompt:
          "Which material does the passage say is NOT suitable for thermal mass?",
        correct_answer: { word_limit: 1, accepted: ["wood"] },
      },
    ],
  },
];

async function upsertReadingTask(spec: ReadingTestSpec, approverId: string) {
  const body: Prisma.InputJsonValue = {
    title: spec.passage.title,
    paragraphs: spec.passage.paragraphs,
    ...(spec.passage.matching_groups
      ? { matching_groups: spec.passage.matching_groups }
      : {}),
    ...(spec.passage.completion_blocks
      ? { completion_blocks: spec.passage.completion_blocks }
      : {}),
    ...(spec.passage.gt_context ? { gt_context: spec.passage.gt_context } : {}),
  };
  await prisma.test.upsert({
    where: { id: spec.id },
    update: {
      track: spec.track,
      section: "Reading",
      difficulty: spec.difficulty,
      status: "Approved",
      approved_by: approverId,
      body_json: body,
    },
    create: {
      id: spec.id,
      track: spec.track,
      section: "Reading",
      difficulty: spec.difficulty,
      status: "Approved",
      approved_by: approverId,
      body_json: body,
    },
  });
  for (const q of spec.questions) {
    await prisma.question.upsert({
      where: { id: q.id },
      update: {
        test_id: spec.id,
        type: q.type,
        prompt: q.prompt,
        points: 1,
        position: q.position,
        correct_answer: q.correct_answer as unknown as Prisma.InputJsonValue,
        visual: Prisma.JsonNull,
      },
      create: {
        id: q.id,
        test_id: spec.id,
        type: q.type,
        prompt: q.prompt,
        points: 1,
        position: q.position,
        correct_answer: q.correct_answer as unknown as Prisma.InputJsonValue,
        visual: Prisma.JsonNull,
      },
    });
  }
}

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
  await upsertSystemOrg();

  // Plans first — orgs that get backfilled need a plan_id to point at.
  let internalPlanId: string | null = null;
  for (const spec of PLANS) {
    const plan = await upsertPlan(spec);
    if (spec.slug === "internal") internalPlanId = plan.id;
  }
  if (!internalPlanId) {
    throw new Error("Internal plan not found after upsert — seed bug.");
  }

  const orgA = await upsertOrg(ORG_A);
  const orgB = await upsertOrg(ORG_B);

  await backfillOrgsToInternalPlan(internalPlanId);

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
  for (const spec of READING_TASKS) {
    await upsertReadingTask(spec, superAdmin.id);
  }

  const userCount = await prisma.user.count();
  const orgCount = await prisma.organization.count({
    where: { id: { in: [orgA.id, orgB.id] } },
  });
  const writingTestCount = await prisma.test.count({
    where: { section: "Writing", status: "Approved" },
  });
  const readingTestCount = await prisma.test.count({
    where: { section: "Reading", status: "Approved" },
  });
  const planCount = await prisma.plan.count();

  console.log(
    `Seed complete: ${orgCount} demo orgs, ${userCount} users, ` +
      `${planCount} plans, ` +
      `${writingTestCount} approved Writing tests, ` +
      `${readingTestCount} approved Reading tests in DB ` +
      `(SuperAdmin: ${SUPER_EMAIL}).`,
  );

  // Mirror the DB rows we just seeded into Clerk so every demo email can
  // sign in with the dev password immediately. Refuses to run against a
  // production Clerk tenant — see packages/db/src/clerk-seed.ts.
  await seedClerkIdentities();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
