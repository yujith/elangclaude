import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { SYSTEM_ORG_ID, SYSTEM_ORG_NAME } from "./system-org";
import { withOrg } from "./tenancy";
import { createTestOrg, ctxFor, resetDatabase } from "./test-helpers";
import { DEFAULT_BRANDING } from "./branding";
import {
  getBrandingForOrgAsSuperAdmin,
  getOrgBrandingSnapshot,
  removeOrgLogoForOrg,
  resetBrandingForOrgAsSuperAdmin,
  resetOrgBrandingForOrg,
  saveOrgBrandingForOrg,
  setOrgLogoForOrg,
} from "./org-branding";

const GREEN_THEME = {
  primary_color: "#2E8B57",
  surface_dark_color: "#10231B",
  font_key: "nunito",
};

beforeEach(async () => {
  await resetDatabase();
});

describe("saveOrgBrandingForOrg", () => {
  it("persists a valid theme and logs branding.updated under the org", async () => {
    const org = await createTestOrg("A");
    const ctx = ctxFor(org);

    const result = await saveOrgBrandingForOrg(ctx, GREEN_THEME);
    expect(result.ok).toBe(true);

    const snapshot = await getOrgBrandingSnapshot(ctx);
    expect(snapshot.customised).toBe(true);
    expect(snapshot.theme.primary_color).toBe("#2E8B57");
    expect(snapshot.theme.font_key).toBe("nunito");

    const log = await withOrg(ctx).activityLog.findFirst({
      where: { action: "branding.updated" },
    });
    expect(log).not.toBeNull();
    expect(log!.org_id).toBe(org.id);
  });

  it("refuses an invalid palette and writes nothing", async () => {
    const org = await createTestOrg("A");
    const ctx = ctxFor(org);

    const result = await saveOrgBrandingForOrg(ctx, {
      ...GREEN_THEME,
      primary_color: "#FFE680",
    });
    expect(result).toEqual({ ok: false, reason: "accent_unreadable_on_light" });
    expect((await getOrgBrandingSnapshot(ctx)).row).toBeNull();
  });

  it("upserts: a second save updates the same row", async () => {
    const org = await createTestOrg("A");
    const ctx = ctxFor(org);
    await saveOrgBrandingForOrg(ctx, GREEN_THEME);
    const second = await saveOrgBrandingForOrg(ctx, {
      ...GREEN_THEME,
      primary_color: "#C2410C",
    });
    expect(second.ok).toBe(true);
    const rows = await prisma.orgBranding.findMany({
      where: { org_id: org.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.primary_color).toBe("#C2410C");
  });
});

describe("tenant isolation", () => {
  it("org B cannot read org A's branding through withOrg", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    await saveOrgBrandingForOrg(ctxFor(orgA), GREEN_THEME);

    const dbB = withOrg(ctxFor(orgB));
    expect(await dbB.orgBranding.findFirst()).toBeNull();
    expect(
      await dbB.orgBranding.findUnique({ where: { org_id: orgA.id } }),
    ).toBeNull();

    const snapshotB = await getOrgBrandingSnapshot(ctxFor(orgB));
    expect(snapshotB.row).toBeNull();
    expect(snapshotB.theme).toEqual(DEFAULT_BRANDING);
  });

  it("org B's reset cannot delete org A's branding", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    await saveOrgBrandingForOrg(ctxFor(orgA), GREEN_THEME);

    await resetOrgBrandingForOrg(ctxFor(orgB));

    expect(
      await prisma.orgBranding.findUnique({ where: { org_id: orgA.id } }),
    ).not.toBeNull();
  });

  it("create clamps org_id to the caller's org even if smuggled", async () => {
    const orgA = await createTestOrg("A");
    const orgB = await createTestOrg("B");
    const dbA = withOrg(ctxFor(orgA));

    await dbA.orgBranding.create({
      // Deliberately smuggling a foreign org_id — the proxy must clamp it.
      data: { ...GREEN_THEME, org_id: orgB.id },
    });

    const row = await prisma.orgBranding.findFirst();
    expect(row!.org_id).toBe(orgA.id);
  });
});

describe("reset + logo lifecycle", () => {
  it("reset removes the row and surfaces the logo key for R2 cleanup", async () => {
    const org = await createTestOrg("A");
    const ctx = ctxFor(org);
    await saveOrgBrandingForOrg(ctx, GREEN_THEME);
    await setOrgLogoForOrg(ctx, {
      logo_object_key: `branding/${org.id}/logo.png`,
    });

    const result = await resetOrgBrandingForOrg(ctx);
    expect(result.removed_logo_object_key).toBe(
      `branding/${org.id}/logo.png`,
    );
    expect((await getOrgBrandingSnapshot(ctx)).row).toBeNull();
  });

  it("logo upload before any colour save creates a default-coloured row", async () => {
    const org = await createTestOrg("A");
    const ctx = ctxFor(org);

    await setOrgLogoForOrg(ctx, {
      logo_object_key: `branding/${org.id}/logo.png`,
    });

    const snapshot = await getOrgBrandingSnapshot(ctx);
    expect(snapshot.row?.logo_object_key).toBe(`branding/${org.id}/logo.png`);
    expect(snapshot.theme).toEqual(DEFAULT_BRANDING);
  });

  it("replacing a logo returns the previous key as an orphan", async () => {
    const org = await createTestOrg("A");
    const ctx = ctxFor(org);
    await setOrgLogoForOrg(ctx, {
      logo_object_key: `branding/${org.id}/logo.png`,
    });
    const second = await setOrgLogoForOrg(ctx, {
      logo_object_key: `branding/${org.id}/logo.webp`,
    });
    expect(second.previous_logo_object_key).toBe(
      `branding/${org.id}/logo.png`,
    );

    const removed = await removeOrgLogoForOrg(ctx);
    expect(removed.removed_logo_object_key).toBe(
      `branding/${org.id}/logo.webp`,
    );
    expect(
      (await getOrgBrandingSnapshot(ctx)).row?.logo_object_key,
    ).toBeNull();
  });
});

describe("SuperAdmin variants", () => {
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

  it("reads any org's branding and resets it, logging under SYSTEM_ORG_ID", async () => {
    await ensureSystemOrg();
    const orgA = await createTestOrg("A");
    const superOrg = await createTestOrg("S");
    const superCtx = ctxFor(superOrg, "SuperAdmin");

    await saveOrgBrandingForOrg(ctxFor(orgA), GREEN_THEME);

    const seen = await getBrandingForOrgAsSuperAdmin(superCtx, orgA.id);
    expect(seen.customised).toBe(true);

    const reset = await resetBrandingForOrgAsSuperAdmin(superCtx, orgA.id);
    expect(reset.ok).toBe(true);
    expect(
      await prisma.orgBranding.findUnique({ where: { org_id: orgA.id } }),
    ).toBeNull();

    const log = await prisma.activityLog.findFirst({
      where: { action: "super.branding.reset" },
    });
    expect(log!.org_id).toBe(SYSTEM_ORG_ID);
    expect(log!.metadata).toMatchObject({ target_org_id: orgA.id });
  });

  it("refuses non-SuperAdmin callers", async () => {
    const orgA = await createTestOrg("A");
    await expect(
      resetBrandingForOrgAsSuperAdmin(ctxFor(orgA, "OrgAdmin"), orgA.id),
    ).rejects.toThrow(/SuperAdmin/);
  });
});
