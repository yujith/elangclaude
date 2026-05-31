// E2E: compact learner practice pickers.
//
// Covers:
//   - Reading, Listening, Writing, and Speaking picker rows render.
//   - The new server-rendered filters narrow each section catalog.
//   - Existing learner dev-session auth still reaches the picker pages.

import { test, expect, type BrowserContext } from "@playwright/test";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";

loadEnv({ path: resolve(__dirname, "../../../../packages/db/.env") });
const prisma = new PrismaClient();
const SECRET = process.env.DEV_SESSION_SECRET || "elc-dev-not-for-production";
const COOKIE_NAME = "elc_dev_session";

function signSession(userId: string): string {
  const sig = createHmac("sha256", SECRET).update(userId).digest("hex");
  return `${userId}.${sig}`;
}

const RUN_TAG = `${Date.now()}`;
const ORG_ID = `e2e_pp_org_${RUN_TAG}`;
const LEARNER_ID = `e2e_pp_learner_${RUN_TAG}`;

const TEST_IDS = {
  readingEasy: `e2e_pp_reading_easy_${RUN_TAG}`,
  readingHard: `e2e_pp_reading_hard_${RUN_TAG}`,
  listening: `e2e_pp_listening_${RUN_TAG}`,
  writingTask1: `e2e_pp_writing_t1_${RUN_TAG}`,
  writingTask2: `e2e_pp_writing_t2_${RUN_TAG}`,
  speakingBooks: `e2e_pp_speaking_books_${RUN_TAG}`,
  speakingTransport: `e2e_pp_speaking_transport_${RUN_TAG}`,
};

test.describe("compact practice pickers", () => {
  test.beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: ORG_ID,
        name: `E2E Practice Pickers ${RUN_TAG}`,
        seat_limit: 10,
        quota_daily: 100,
        quota_monthly: 1000,
        status: "Active",
      },
    });
    await prisma.user.create({
      data: {
        id: LEARNER_ID,
        org_id: ORG_ID,
        email: `e2e-pp-learner-${RUN_TAG}@e2e.test`,
        name: "Picker Learner",
        role: "Learner",
        ielts_track: "Academic",
      },
    });
    await seedReadingTest({
      id: TEST_IDS.readingEasy,
      difficulty: 2,
      title: "Coral gardens and coastal science",
    });
    await seedReadingTest({
      id: TEST_IDS.readingHard,
      difficulty: 5,
      title: "Mountain railways in winter",
    });
    await prisma.test.create({
      data: {
        id: TEST_IDS.listening,
        track: "Academic",
        section: "Listening",
        difficulty: 3,
        status: "Approved",
        body_json: listeningContent() as Prisma.InputJsonValue,
        questions: {
          create: {
            type: "listening-short-answer",
            prompt: "What membership type does Maria choose?",
            position: 0,
          },
        },
      },
    });
    await seedWritingTest({
      id: TEST_IDS.writingTask1,
      difficulty: 2,
      type: "writing-task-1-academic",
      prompt: "The chart below shows changes in public transport use.",
    });
    await seedWritingTest({
      id: TEST_IDS.writingTask2,
      difficulty: 5,
      type: "writing-task-2",
      prompt: "Some people think cities should limit private cars.",
    });
    await seedSpeakingTest({
      id: TEST_IDS.speakingBooks,
      difficulty: 4,
      domain: "books and reading",
      cue: "Describe a book you recently read and enjoyed.",
    });
    await seedSpeakingTest({
      id: TEST_IDS.speakingTransport,
      difficulty: 2,
      domain: "urban transport",
      cue: "Describe a journey you often take in your city.",
    });
  });

  test.afterAll(async () => {
    await prisma.test.deleteMany({ where: { id: { in: Object.values(TEST_IDS) } } });
    await prisma.user.deleteMany({ where: { id: LEARNER_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await prisma.$disconnect();
  });

  test("Reading rows render and filter by difficulty", async ({
    context,
    page,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, LEARNER_ID);
    await page.goto("/practice/reading");

    await expect(page.getByText(/Showing \d+ of \d+ passages\./)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Coral gardens and coastal science" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Mountain railways in winter" }),
    ).toBeVisible();

    await page.locator('select[name="difficulty"]').selectOption("2");
    await page.getByRole("button", { name: "Filter" }).click();

    await expect(page.getByText(/Showing \d+ of \d+ passages\./)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Coral gardens and coastal science" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Mountain railways in winter" }),
    ).toBeHidden();
  });

  test("Listening rows render and filter by accent", async ({
    context,
    page,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, LEARNER_ID);
    await page.goto("/practice/listening");

    await expect(page.getByText(/Showing \d+ of \d+ sections\./)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Applying for a library card/ }),
    ).toBeVisible();

    await page.getByLabel("Accent").selectOption("canadian");
    await page.getByRole("button", { name: "Filter" }).click();

    await expect(page.getByText(/Showing \d+ of \d+ sections\./)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Applying for a library card/ }),
    ).toBeVisible();
  });

  test("Writing rows render and filter by task type", async ({
    context,
    page,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, LEARNER_ID);
    await page.goto("/practice/writing");

    await expect(page.getByText(/Showing \d+ of \d+ tasks\./)).toBeVisible();
    await expect(page.getByText(/public transport use/)).toBeVisible();
    await expect(page.getByText(/limit private cars/)).toBeVisible();

    await page.getByLabel("Task").selectOption("task2");
    await page.getByRole("button", { name: "Filter" }).click();

    await expect(page.getByText(/Showing \d+ of \d+ tasks\./)).toBeVisible();
    await expect(page.getByText(/limit private cars/)).toBeVisible();
    await expect(page.getByText(/public transport use/)).toBeHidden();
  });

  test("Speaking rows render and filter by domain", async ({
    context,
    page,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, LEARNER_ID);
    await page.goto("/practice/speaking");

    await expect(page.getByText(/Showing \d+ of \d+ tests\./)).toBeVisible();
    await expect(page.getByText(/book you recently read/)).toBeVisible();
    await expect(page.getByText(/journey you often take/)).toBeVisible();

    await page.getByLabel("Domain").selectOption("urban transport");
    await page.getByRole("button", { name: "Filter" }).click();

    await expect(page.getByText(/Showing \d+ of \d+ tests\./)).toBeVisible();
    await expect(page.getByText(/journey you often take/)).toBeVisible();
    await expect(page.getByText(/book you recently read/)).toBeHidden();
  });
});

async function seedReadingTest({
  id,
  difficulty,
  title,
}: {
  id: string;
  difficulty: number;
  title: string;
}) {
  await prisma.test.create({
    data: {
      id,
      track: "Academic",
      section: "Reading",
      difficulty,
      status: "Approved",
      body_json: {
        title,
        paragraphs: [
          {
            label: "A",
            text: `${title} has become a useful case study for IELTS learners who need concise academic practice.`,
          },
        ],
      },
      questions: {
        create: {
          type: "reading-short-answer",
          prompt: "What kind of practice does the passage support?",
          position: 0,
        },
      },
    },
  });
}

async function seedWritingTest({
  id,
  difficulty,
  type,
  prompt,
}: {
  id: string;
  difficulty: number;
  type: string;
  prompt: string;
}) {
  await prisma.test.create({
    data: {
      id,
      track: "Academic",
      section: "Writing",
      difficulty,
      status: "Approved",
      questions: {
        create: {
          type,
          prompt,
          position: 0,
        },
      },
    },
  });
}

function listeningContent() {
  const speaker = (id: string, accent: string) => ({
    id,
    name: id,
    role: "speaker",
    accent,
  });
  return {
    schema_version: 1,
    parts: [
      listeningPart(1, "Applying for a library card", "social", 0, [
        speaker("receptionist", "british"),
        speaker("caller", "australian"),
      ]),
      listeningPart(2, "Community garden tour", "social", 1, [
        speaker("guide", "american"),
      ]),
      listeningPart(3, "Seminar planning discussion", "academic", 2, [
        speaker("tutor", "british"),
        speaker("student", "canadian"),
      ]),
      listeningPart(4, "Lecture on coastal change", "academic", 3, [
        speaker("lecturer", "new-zealand"),
      ]),
    ],
  };
}

function listeningPart(
  part: number,
  title: string,
  context: string,
  questionPosition: number,
  speakers: { id: string; name: string; role: string; accent: string }[],
) {
  return {
    part,
    context,
    title,
    speakers,
    question_positions: [questionPosition],
    transcript: [
      {
        kind: "questions-preview",
        seconds: 30,
        question_positions: [questionPosition],
      },
      {
        kind: "speech",
        speaker_id: speakers[0]!.id,
        text: `This is Part ${part}, ${title}.`,
      },
      {
        kind: "reading-pause",
        seconds: 30,
        instruction: `Check your answer to Part ${part}.`,
      },
    ],
  };
}

async function seedSpeakingTest({
  id,
  difficulty,
  domain,
  cue,
}: {
  id: string;
  difficulty: number;
  domain: string;
  cue: string;
}) {
  await prisma.test.create({
    data: {
      id,
      track: "Academic",
      section: "Speaking",
      difficulty,
      status: "Approved",
      body_json: {
        topic_domain: domain,
        part1: {
          theme: "Daily life",
          subtopics: [
            {
              topic: "Home",
              questions: ["Where do you live?", "What do you like about it?"],
            },
          ],
        },
        part2: {
          cue_card_topic: cue,
          bullets: ["what it was", "when it happened", "why it mattered"],
          final_prompt: "and explain why you remember it.",
          followup_questions: ["Would you do it again?"],
        },
        part3: {
          theme: domain,
          questions: [
            "Why is this topic important today?",
            "How might it change in the future?",
          ],
        },
      },
    },
  });
}

async function setSessionCookie(
  context: BrowserContext,
  baseURL: string,
  userId: string,
): Promise<void> {
  const url = new URL(baseURL);
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: signSession(userId),
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
