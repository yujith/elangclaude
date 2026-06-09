// Org custom branding — DB helpers (ADR-0023).
//
// The pure theming policy (validation, palette derivation, CSS mapping)
// lives in branding.ts; this module is the only writer of OrgBranding rows.
// Every write goes through validateBranding(), so the theme renderer can
// trust any row it reads.
//
// The Next server actions in apps/web/lib/admin/branding-actions.ts are thin
// wrappers that run requireRole("OrgAdmin") and forward here; the SuperAdmin
// reset lives on /orgs/[id] and forwards to the *AsSuperAdmin variants.

import { prisma } from "./client";
import { SYSTEM_ORG_ID } from "./system-org";
import { withOrg, withSuperAdminContext, type OrgContext } from "./tenancy";
import {
  resolveBrandingTheme,
  validateBranding,
  type BrandingFailureReason,
  type BrandingInput,
  type BrandingTheme,
} from "./branding";

export type OrgBrandingSnapshot = {
  /** The theme surfaces should render (falls back to platform default). */
  theme: BrandingTheme;
  /** True when a custom row exists AND is enabled AND valid. */
  customised: boolean;
  /** Raw row state for the editor; null when the org never branded. */
  row: {
    enabled: boolean;
    primary_color: string;
    surface_dark_color: string;
    font_key: string;
    logo_object_key: string | null;
    logo_updated_at: Date | null;
    updatedAt: Date;
  } | null;
};

export type SaveBrandingResult =
  | { ok: true; theme: BrandingTheme }
  | { ok: false; reason: BrandingFailureReason };

export type ResetBrandingResult = {
  ok: true;
  /** R2 key of the org's uploaded logo, for the caller to delete. */
  removed_logo_object_key: string | null;
};

const ROW_SELECT = {
  enabled: true,
  primary_color: true,
  surface_dark_color: true,
  font_key: true,
  logo_object_key: true,
  logo_updated_at: true,
  updatedAt: true,
} as const;

// ─── Reads (any role in the org) ───────────────────────────────────────────

export async function getOrgBrandingSnapshot(
  ctx: OrgContext,
): Promise<OrgBrandingSnapshot> {
  const db = withOrg(ctx);
  const row = await db.orgBranding.findFirst({ select: ROW_SELECT });
  const theme = resolveBrandingTheme(row);
  return {
    theme,
    customised: row !== null && row.enabled && validateBranding(row).ok,
    row,
  };
}

// ─── OrgAdmin writes ───────────────────────────────────────────────────────

export async function saveOrgBrandingForOrg(
  ctx: OrgContext,
  input: BrandingInput,
): Promise<SaveBrandingResult> {
  const checked = validateBranding(input);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  const { value } = checked;

  const db = withOrg(ctx);
  const data = {
    enabled: value.enabled,
    primary_color: value.primary_color,
    surface_dark_color: value.surface_dark_color,
    font_key: value.font_key,
  };
  await db.$transaction([
    db.orgBranding.upsert({
      where: { org_id: ctx.org_id },
      create: { ...data, org_id: ctx.org_id },
      update: data,
    }),
    db.activityLog.create({
      data: {
        org_id: ctx.org_id,
        user_id: ctx.user_id,
        action: "branding.updated",
        metadata: data,
      },
    }),
  ]);
  return { ok: true, theme: value };
}

export async function resetOrgBrandingForOrg(
  ctx: OrgContext,
): Promise<ResetBrandingResult> {
  const db = withOrg(ctx);
  const existing = await db.orgBranding.findFirst({
    select: { id: true, logo_object_key: true },
  });
  if (!existing) return { ok: true, removed_logo_object_key: null };

  await db.$transaction([
    db.orgBranding.deleteMany({}),
    db.activityLog.create({
      data: {
        org_id: ctx.org_id,
        user_id: ctx.user_id,
        action: "branding.reset",
        metadata: {},
      },
    }),
  ]);
  return { ok: true, removed_logo_object_key: existing.logo_object_key };
}

/**
 * Stamps the uploaded logo's R2 key. Creates the row with platform-default
 * colours when the org uploads a logo before ever touching colours. Returns
 * the PREVIOUS key (if it differs) so the caller can delete the orphan.
 */
export async function setOrgLogoForOrg(
  ctx: OrgContext,
  input: { logo_object_key: string },
): Promise<{ ok: true; previous_logo_object_key: string | null }> {
  const db = withOrg(ctx);
  const existing = await db.orgBranding.findFirst({
    select: { logo_object_key: true },
  });
  await db.$transaction([
    db.orgBranding.upsert({
      where: { org_id: ctx.org_id },
      create: {
        org_id: ctx.org_id,
        enabled: true,
        primary_color: "#EE2346",
        surface_dark_color: "#0A0A0A",
        font_key: "rubik",
        logo_object_key: input.logo_object_key,
        logo_updated_at: new Date(),
      },
      update: {
        logo_object_key: input.logo_object_key,
        logo_updated_at: new Date(),
      },
    }),
    db.activityLog.create({
      data: {
        org_id: ctx.org_id,
        user_id: ctx.user_id,
        action: "branding.logo_updated",
        metadata: {},
      },
    }),
  ]);
  const previous = existing?.logo_object_key ?? null;
  return {
    ok: true,
    previous_logo_object_key:
      previous && previous !== input.logo_object_key ? previous : null,
  };
}

export async function removeOrgLogoForOrg(
  ctx: OrgContext,
): Promise<{ ok: true; removed_logo_object_key: string | null }> {
  const db = withOrg(ctx);
  const existing = await db.orgBranding.findFirst({
    select: { logo_object_key: true },
  });
  if (!existing?.logo_object_key) {
    return { ok: true, removed_logo_object_key: null };
  }
  await db.$transaction([
    db.orgBranding.updateMany({
      data: { logo_object_key: null, logo_updated_at: null },
    }),
    db.activityLog.create({
      data: {
        org_id: ctx.org_id,
        user_id: ctx.user_id,
        action: "branding.logo_removed",
        metadata: {},
      },
    }),
  ]);
  return { ok: true, removed_logo_object_key: existing.logo_object_key };
}

// ─── SuperAdmin (cross-org) ────────────────────────────────────────────────

export async function getBrandingForOrgAsSuperAdmin(
  ctx: OrgContext,
  org_id: string,
): Promise<OrgBrandingSnapshot> {
  const db = withSuperAdminContext(ctx);
  const row = await db.orgBranding.findUnique({
    where: { org_id },
    select: ROW_SELECT,
  });
  const theme = resolveBrandingTheme(row);
  return {
    theme,
    customised: row !== null && row.enabled && validateBranding(row).ok,
    row,
  };
}

export async function resetBrandingForOrgAsSuperAdmin(
  ctx: OrgContext,
  org_id: string,
): Promise<ResetBrandingResult> {
  const db = withSuperAdminContext(ctx);
  if (org_id === SYSTEM_ORG_ID) {
    return { ok: true, removed_logo_object_key: null };
  }
  const existing = await db.orgBranding.findUnique({
    where: { org_id },
    select: { logo_object_key: true },
  });
  if (!existing) return { ok: true, removed_logo_object_key: null };

  await db.$transaction([
    db.orgBranding.delete({ where: { org_id } }),
    db.activityLog.create({
      data: {
        org_id: SYSTEM_ORG_ID,
        user_id: ctx.user_id,
        action: "super.branding.reset",
        metadata: { target_org_id: org_id },
      },
    }),
  ]);
  return { ok: true, removed_logo_object_key: existing.logo_object_key };
}
