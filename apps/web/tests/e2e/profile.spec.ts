// E2E: the /profile self-service surface.
//
// Covers:
//   - Top-level /profile renders the same shell for any role.
//   - IELTS track flip persists in the DB and survives a reload.
//   - In-progress Attempt blocks the switch (server + form both reflect it).
//
// Like the other specs, we bypass Clerk by stamping the dev-session cookie
// that loadOrgContext reads when NODE_ENV !== "production". The Clerk
// <UserProfile /> widget is gated by <Show when="signed-in"> so the dev-only
// session sees the fallback copy instead.

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
const ORG_ID = `e2e_pf_org_${RUN_TAG}`;
const LEARNER_ID = `e2e_pf_learner_${RUN_TAG}`;
const TEST_ID = `e2e_pf_test_${RUN_TAG}`;
const ATTEMPT_ID = `e2e_pf_attempt_${RUN_TAG}`;

test.describe("/profile self-service surface", () => {
  test.beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: ORG_ID,
        name: `E2E Profile ${RUN_TAG}`,
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
        email: `e2e-pf-learner-${RUN_TAG}@e2e.test`,
        name: "Maya ProfileE2E",
        role: "Learner",
        ielts_track: "Academic",
      },
    });
    await prisma.test.create({
      data: {
        id: TEST_ID,
        track: "Academic",
        section: "Reading",
        difficulty: 5,
        status: "Approved",
      },
    });
  });

  test.beforeEach(async () => {
    // Reset track + clear any in-progress attempts between tests.
    await prisma.attempt.deleteMany({ where: { user_id: LEARNER_ID } });
    await prisma.activityLog.deleteMany({
      where: { user_id: LEARNER_ID, action: "profile.track_changed" },
    });
    await prisma.user.update({
      where: { id: LEARNER_ID },
      data: { ielts_track: "Academic" },
    });
  });

  test.afterAll(async () => {
    await prisma.activityLog.deleteMany({ where: { user_id: LEARNER_ID } });
    await prisma.attempt.deleteMany({ where: { user_id: LEARNER_ID } });
    await prisma.test.deleteMany({ where: { id: TEST_ID } });
    await prisma.user.deleteMany({ where: { id: LEARNER_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await prisma.$disconnect();
  });

  test("flips track and persists across reload", async ({
    context,
    page,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, LEARNER_ID);
    await page.goto("/profile");

    await expect(
      page.getByRole("heading", { name: "Your profile", level: 1 }),
    ).toBeVisible();

    const academic = page.getByRole("radio", { name: "Academic" });
    const gt = page.getByRole("radio", { name: "General Training" });
    await expect(academic).toBeChecked();
    await expect(gt).not.toBeChecked();

    await gt.check();
    await page.getByRole("button", { name: /Save preference/ }).click();

    await expect(page.getByText(/Section pickers will show your new track/)).toBeVisible();

    // DB now reflects the new track.
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: LEARNER_ID },
      select: { ielts_track: true },
    });
    expect(row.ielts_track).toBe("GeneralTraining");

    // And reload picks it up server-side.
    await page.reload();
    await expect(page.getByRole("radio", { name: "General Training" })).toBeChecked();
  });

  test("in-progress Attempt disables the form and surfaces the block copy", async ({
    context,
    page,
    baseURL,
  }) => {
    await prisma.attempt.create({
      data: {
        id: ATTEMPT_ID,
        org_id: ORG_ID,
        user_id: LEARNER_ID,
        test_id: TEST_ID,
        section: "Reading",
        status: "InProgress",
      },
    });

    await setSessionCookie(context, baseURL!, LEARNER_ID);
    await page.goto("/profile");

    await expect(
      page.getByText(
        /Finish or abandon your in-progress session before switching tracks\./,
      ),
    ).toBeVisible();

    const gt = page.getByRole("radio", { name: "General Training" });
    await expect(gt).toBeDisabled();

    const save = page.getByRole("button", { name: /Save preference/ });
    await expect(save).toBeDisabled();
  });

  test("Clerk profile subroutes reload inside the profile shell", async ({
    context,
    page,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, LEARNER_ID);
    await page.goto("/profile/security");

    await expect(
      page.getByRole("heading", { name: "Your profile", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Password & devices", level: 2 }),
    ).toBeVisible();
  });

  test("blocked Clerk account routes land on security", async ({
    context,
    page,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, LEARNER_ID);
    await page.goto("/profile/account");

    await expect(page).toHaveURL(/\/profile\/security$/);
    await expect(
      page.getByRole("heading", { name: "Password & devices", level: 2 }),
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
