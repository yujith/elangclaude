// E2E: org custom branding (ADR-0023).
//
// Covers:
//   - OrgAdmin edits /admin/branding: invalid palettes are blocked inline,
//     a valid palette + font saves.
//   - The org's learner sees the theme override on /home; the admin chrome
//     carries it too.
//   - A learner in ANOTHER org sees no override (tenant isolation at the
//     rendering layer).
//   - axe finds no WCAG 2.1 AA violations on the editor.
//
// Bypasses Clerk via the signed dev-session cookie, like the other specs.

import { test, expect, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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

async function setSessionCookie(
  context: BrowserContext,
  baseURL: string,
  userId: string,
) {
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

const RUN_TAG = `${Date.now()}`;
const ORG_A_ID = `e2e_br_org_a_${RUN_TAG}`;
const ORG_B_ID = `e2e_br_org_b_${RUN_TAG}`;
const ADMIN_A_ID = `e2e_br_admin_a_${RUN_TAG}`;
const LEARNER_A_ID = `e2e_br_learner_a_${RUN_TAG}`;
const LEARNER_B_ID = `e2e_br_learner_b_${RUN_TAG}`;

// Passes every contrast gate against the default #0A0A0A surface.
const NEW_ACCENT = "#3B82F6";

test.describe("org custom branding", () => {
  test.beforeAll(async () => {
    for (const [orgId, label] of [
      [ORG_A_ID, "A"],
      [ORG_B_ID, "B"],
    ] as const) {
      await prisma.organization.create({
        data: {
          id: orgId,
          name: `E2E Branding ${label} ${RUN_TAG}`,
          seat_limit: 10,
          quota_daily: 100,
          quota_monthly: 1000,
          status: "Active",
        },
      });
    }
    await prisma.user.createMany({
      data: [
        {
          id: ADMIN_A_ID,
          org_id: ORG_A_ID,
          email: `e2e-br-admin-a-${RUN_TAG}@e2e.test`,
          name: "Asha BrandAdmin",
          role: "OrgAdmin",
          ielts_track: "Academic",
        },
        {
          id: LEARNER_A_ID,
          org_id: ORG_A_ID,
          email: `e2e-br-learner-a-${RUN_TAG}@e2e.test`,
          name: "Liam BrandLearner",
          role: "Learner",
          ielts_track: "Academic",
        },
        {
          id: LEARNER_B_ID,
          org_id: ORG_B_ID,
          email: `e2e-br-learner-b-${RUN_TAG}@e2e.test`,
          name: "Bea OtherOrg",
          role: "Learner",
          ielts_track: "Academic",
        },
      ],
    });
  });

  test.afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: [ORG_A_ID, ORG_B_ID] } },
    });
    await prisma.$disconnect();
  });

  test("editor blocks an unreadable palette inline", async ({
    context,
    page,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, ADMIN_A_ID);
    await page.goto("/admin/branding");

    const accent = page.getByLabel("Accent colour", { exact: true });
    await accent.fill("#FFE680");

    // Filtered: Next's route announcer is also role=alert.
    await expect(
      page.getByRole("alert").filter({ hasText: /too pale/ }),
    ).toContainText(/too pale to read on white/);
    await expect(
      page.getByRole("button", { name: "Save branding" }),
    ).toBeDisabled();
  });

  test("OrgAdmin saves a theme; own learner sees it, other org doesn't", async ({
    context,
    page,
    baseURL,
    browser,
  }) => {
    await setSessionCookie(context, baseURL!, ADMIN_A_ID);
    await page.goto("/admin/branding");

    await page.getByLabel("Accent colour", { exact: true }).fill(NEW_ACCENT);
    await page.getByRole("radio", { name: "Nunito" }).check();
    await page.getByRole("button", { name: "Save branding" }).click();
    await expect(page.getByRole("status")).toContainText(/Saved/);

    // The admin's own chrome picks the theme up after refresh.
    await page.goto("/admin");
    await expect(
      page.locator(`div[style*="${NEW_ACCENT}"]`).first(),
    ).toBeAttached();

    // Same-org learner sees the override.
    const learnerCtx = await browser.newContext();
    await setSessionCookie(learnerCtx, baseURL!, LEARNER_A_ID);
    const learnerPage = await learnerCtx.newPage();
    await learnerPage.goto("/home");
    await expect(
      learnerPage.locator(`div[style*="${NEW_ACCENT}"]`).first(),
    ).toBeAttached();
    await learnerCtx.close();

    // Other-org learner does NOT.
    const otherCtx = await browser.newContext();
    await setSessionCookie(otherCtx, baseURL!, LEARNER_B_ID);
    const otherPage = await otherCtx.newPage();
    await otherPage.goto("/home");
    await expect(
      otherPage.locator(`div[style*="${NEW_ACCENT}"]`),
    ).toHaveCount(0);
    await expect(
      otherPage.locator('div[style*="--brand-red"]'),
    ).toHaveCount(0);
    await otherCtx.close();
  });

  test("axe: /admin/branding has no WCAG 2.1 AA violations", async ({
    context,
    page,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, ADMIN_A_ID);
    await page.goto("/admin/branding");
    await expect(
      page.getByRole("heading", { name: "Branding." }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // The live preview is a decorative aria-hidden mock of learner chrome;
      // its contrast is governed by validateBranding(), not this page.
      .exclude('[aria-hidden="true"]')
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
