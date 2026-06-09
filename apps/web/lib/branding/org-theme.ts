// Org theme resolution for server layouts (ADR-0023).
//
// getOrgTheme() reads the caller's OrgBranding through withOrg(ctx) — org
// always from the session, never from params — and resolves it to a
// renderable theme (platform default when absent/disabled/invalid).
// React-cached so layouts and nested components share one DB read per
// request.
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
import { getOrgBrandingSnapshot } from "@elc/db/org-branding";
import { requireOrgContext } from "@/lib/auth/context";

export const getOrgTheme = cache(async (): Promise<BrandingTheme> => {
  const ctx = await requireOrgContext();
  const snapshot = await getOrgBrandingSnapshot(ctx);
  return snapshot.theme;
});

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
