// Org theme resolution for server layouts (ADR-0023).
//
// getOrgBranding() reads the caller's OrgBranding through withOrg(ctx) — org
// always from the session, never from params — React-cached so layouts,
// OrgLogo, and nested components share one DB read per request.
//
// The override is applied as an inline style on each role layout's ROOT DIV,
// never on :root or <body> — public/marketing/super surfaces must stay
// platform-branded. Because `body` declares font-family and color globally
// and descendants inherit *computed* values, the wrapper re-declares both so
// the org's variables actually take effect inside the frame.

import { cache } from "react";
import type { CSSProperties } from "react";
import {
  DEFAULT_BRANDING,
  brandingCssVariables,
  type BrandingTheme,
} from "@elc/db/branding";
import {
  getOrgBrandingSnapshot,
  type OrgBrandingSnapshot,
} from "@elc/db/org-branding";
import { requireOrgContext } from "@/lib/auth/context";

export const getOrgBranding = cache(
  async (): Promise<OrgBrandingSnapshot> => {
    const ctx = await requireOrgContext();
    return getOrgBrandingSnapshot(ctx);
  },
);

export async function getOrgTheme(): Promise<BrandingTheme> {
  return (await getOrgBranding()).theme;
}

/**
 * Cache-busting src for the org logo, or null when the org hasn't uploaded
 * one. Served through /api/branding/logo (signed-URL redirect) — raw R2
 * keys never reach the client.
 */
export async function getOrgLogoSrc(): Promise<string | null> {
  const snapshot = await getOrgBranding();
  const row = snapshot.row;
  if (!row?.logo_object_key) return null;
  const version = row.logo_updated_at?.getTime() ?? 0;
  return `/api/branding/logo?v=${version}`;
}

export function isPlatformDefaultTheme(theme: BrandingTheme): boolean {
  return (
    theme.primary_color === DEFAULT_BRANDING.primary_color &&
    theme.surface_dark_color === DEFAULT_BRANDING.surface_dark_color &&
    theme.font_key === DEFAULT_BRANDING.font_key
  );
}

/**
 * Inline style for a role layout's root element. Undefined for the platform
 * default so unbranded orgs render byte-identical DOM to today.
 */
export function orgThemeStyle(
  theme: BrandingTheme,
): CSSProperties | undefined {
  if (isPlatformDefaultTheme(theme)) return undefined;
  return {
    ...brandingCssVariables(theme),
    fontFamily: "var(--brand-font-body)",
    color: "var(--brand-black)",
  } as CSSProperties;
}
