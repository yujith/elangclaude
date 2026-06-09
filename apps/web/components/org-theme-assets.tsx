// Emits the @font-face rules + preload hints for an org's chosen brand font
// (ADR-0023). Renders nothing for the platform default — Rubik's faces are
// already declared in globals.css.
//
// The CSS is injected via dangerouslySetInnerHTML because React escapes
// quotes in <style> children, which would corrupt url("/fonts/…") and
// font-family names. The content is built exclusively from the BRANDING_FONTS
// allowlist — no user-controlled strings can reach it.

import type { BrandingTheme } from "@elc/db/branding";
import {
  orgFontFaceCss,
  orgFontPreloadPaths,
} from "@/lib/branding/fonts";

export function OrgThemeAssets({ theme }: { theme: BrandingTheme }) {
  const css = orgFontFaceCss(theme.font_key);
  if (!css) return null;
  return (
    <>
      {orgFontPreloadPaths(theme.font_key).map((href) => (
        <link
          key={href}
          rel="preload"
          href={href}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      ))}
      <style dangerouslySetInnerHTML={{ __html: css }} />
    </>
  );
}
