// E2E: Suspended-org users get bounced to /suspended.
//
// This test seeds a Suspended org + OrgAdmin directly into the dev DB
// (the dev server's prisma client reads from DATABASE_URL), signs a
// dev-session cookie for that user with the same HMAC the dev-login
// action uses, and asserts that /admin redirects to /suspended.
//
// Cleanup runs in afterAll so a failed test doesn't leave residue.
// Uses a millisecond-suffixed id so concurrent runs (or stale state
// from a crashed previous run) don't collide.

import { test, expect, type BrowserContext } from "@playwright/test";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

// Playwright's TS loader treats .ts files in apps/web as CJS, so we
// can't import @elc/db/client (its env loader uses `import.meta.url`).
// Instead we stand up a Prisma client of our own and point it at the
// same DATABASE_URL the dev server uses (packages/db/.env).
loadEnv({ path: resolve(__dirname, "../../../../packages/db/.env") });
const prisma = new PrismaClient();
const SECRET = process.env.DEV_SESSION_SECRET || "elc-dev-not-for-production";
const COOKIE_NAME = "elc_dev_session";

function signSession(userId: string): string {
  const sig = createHmac("sha256", SECRET).update(userId).digest("hex");
  return `${userId}.${sig}`;
}

const RUN_TAG = `${Date.now()}`;
const SUSPENDED_ORG_ID = `e2e_suspended_${RUN_TAG}`;
const ACTIVE_ORG_ID = `e2e_active_${RUN_TAG}`;
const SUSPENDED_USER_ID = `e2e_user_susp_${RUN_TAG}`;
const ACTIVE_USER_ID = `e2e_user_act_${RUN_TAG}`;

test.describe("suspend gate", () => {
  test.beforeAll(async () => {
    await prisma.organization.createMany({
      data: [
        {
          id: SUSPENDED_ORG_ID,
          name: `E2E Suspended ${RUN_TAG}`,
          seat_limit: 1,
          quota_daily: 0,
          quota_monthly: 0,
          status: "Suspended",
        },
        {
          id: ACTIVE_ORG_ID,
          name: `E2E Active ${RUN_TAG}`,
          seat_limit: 1,
          quota_daily: 0,
          quota_monthly: 0,
          status: "Active",
        },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: SUSPENDED_USER_ID,
          org_id: SUSPENDED_ORG_ID,
          email: `e2e-susp-${RUN_TAG}@e2e.test`,
          role: "OrgAdmin",
        },
        {
          id: ACTIVE_USER_ID,
          org_id: ACTIVE_ORG_ID,
          email: `e2e-act-${RUN_TAG}@e2e.test`,
          role: "OrgAdmin",
        },
      ],
    });
  });

  test.afterAll(async () => {
    // user → org cascade handles it, but be explicit so a partial
    // failure during seed still cleans up what made it in.
    await prisma.user.deleteMany({
      where: { id: { in: [SUSPENDED_USER_ID, ACTIVE_USER_ID] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [SUSPENDED_ORG_ID, ACTIVE_ORG_ID] } },
    });
    await prisma.$disconnect();
  });

  test("OrgAdmin in a Suspended org is redirected to /suspended", async ({
    context,
    page,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, SUSPENDED_USER_ID);

    await page.goto("/admin");
    await page.waitForURL(/\/suspended/);
    expect(page.url()).toContain("/suspended");
    expect(page.url()).toContain("status=Suspended");
    await expect(
      page.getByRole("heading", { name: /Your organisation is paused/i }),
    ).toBeVisible();
  });

  test("OrgAdmin in an Active org reaches /admin normally", async ({
    context,
    page,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, ACTIVE_USER_ID);

    await page.goto("/admin");
    // No redirect — we should land on the admin overview itself.
    expect(page.url()).toContain("/admin");
    expect(page.url()).not.toContain("/suspended");
    expect(page.url()).not.toContain("/dev/login");
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
