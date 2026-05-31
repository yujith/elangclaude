// E2E: each role lands on the right page with the right personalised
// greeting after sign-in.
//
// Why bypass Clerk's hosted UI?
//   Our code's responsibility is the post-sign-in routing, not Clerk's
//   sign-in form. We mirror the suspend-gate spec by stamping the
//   signed dev-session cookie that `loadOrgContext` reads in the
//   dev-fallback branch. NODE_ENV !== "production" is enforced inside
//   that branch, so this cookie is never honoured against a prod build.
//
// Seeds: one Active org with three users (SuperAdmin / OrgAdmin /
// Learner). Distinct first names so the greeting assertion is sharp.
// Cleanup in afterAll, RUN_TAG-suffixed ids so concurrent or
// previously-crashed runs don't collide.

import { test, expect, type BrowserContext } from "@playwright/test";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: resolve(__dirname, "../../../../packages/db/.env") });
const prisma = new PrismaClient();
const SECRET = process.env.DEV_SESSION_SECRET || "elc-dev-not-for-production";
const COOKIE_NAME = "elc_dev_session";

function signSession(userId: string): string {
  const sig = createHmac("sha256", SECRET).update(userId).digest("hex");
  return `${userId}.${sig}`;
}

const RUN_TAG = `${Date.now()}`;
const ORG_ID = `e2e_rg_org_${RUN_TAG}`;
const SUPER_ID = `e2e_rg_super_${RUN_TAG}`;
const ADMIN_ID = `e2e_rg_admin_${RUN_TAG}`;
const LEARNER_ID = `e2e_rg_learner_${RUN_TAG}`;

test.describe("role greetings", () => {
  test.beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: ORG_ID,
        name: `E2E Role-Greeting ${RUN_TAG}`,
        seat_limit: 50,
        quota_daily: 100,
        quota_monthly: 1000,
        status: "Active",
      },
    });
    await prisma.user.createMany({
      data: [
        {
          id: SUPER_ID,
          org_id: ORG_ID,
          email: `e2e-rg-super-${RUN_TAG}@e2e.test`,
          name: "Alex SuperE2E",
          role: "SuperAdmin",
        },
        {
          id: ADMIN_ID,
          org_id: ORG_ID,
          email: `e2e-rg-admin-${RUN_TAG}@e2e.test`,
          name: "Casey AdminE2E",
          role: "OrgAdmin",
        },
        {
          id: LEARNER_ID,
          org_id: ORG_ID,
          email: `e2e-rg-learner-${RUN_TAG}@e2e.test`,
          name: "Dana LearnerE2E",
          role: "Learner",
        },
      ],
    });
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [SUPER_ID, ADMIN_ID, LEARNER_ID] } },
    });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await prisma.$disconnect();
  });

  test("SuperAdmin lands on /orgs with their first-name greeting", async ({
    context,
    page,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, SUPER_ID);
    await page.goto("/orgs");

    expect(page.url()).toContain("/orgs");
    await expect(
      page.getByText("Welcome back, Alex.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Skills That Open Doorways — admin view."),
    ).toBeVisible();
    // The page's own header — proves we rendered the SuperAdmin
    // landing, not just any page that happens to greet by name.
    await expect(
      page.getByRole("heading", { name: /Organisations\.?/i }),
    ).toBeVisible();
  });

  test("OrgAdmin lands on /admin with their first-name greeting", async ({
    context,
    page,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, ADMIN_ID);
    await page.goto("/admin");

    expect(page.url()).toContain("/admin");
    expect(page.url()).not.toContain("/orgs");
    await expect(
      page.getByText("Welcome back, Casey.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Your learners. Your insights."),
    ).toBeVisible();
    const appHeader = page.locator("body > div > header");
    await expect(
      appHeader.getByRole("link", { name: "eLanguage Center Org admin" }),
    ).toBeVisible();
    const headerNav = appHeader.locator("nav");
    for (const label of ["Overview", "Learners", "Activity", "Profile"]) {
      await expect(headerNav.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(
      appHeader.getByRole("button", { name: "Sign out" }),
    ).toBeVisible();
    // OrgAdmin landing renders an H1 with the org name.
    await expect(
      page.getByRole("heading", { name: /E2E Role-Greeting/i }),
    ).toBeVisible();
  });

  test("Learner lands on /practice/writing with their first-name greeting", async ({
    context,
    page,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, LEARNER_ID);
    await page.goto("/practice/writing");

    expect(page.url()).toContain("/practice/writing");
    await expect(
      page.getByText("Welcome back, Dana.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Let's drill — Skills That Open Doorways."),
    ).toBeVisible();
    // Learner Writing landing's own H1.
    await expect(
      page.getByRole("heading", { name: /Pick a task/i }),
    ).toBeVisible();
  });
});

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
