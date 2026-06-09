// Org custom branding — pure theming policy (ADR-0023).
//
// This module is deliberately PURE (no Prisma, no network) so the rules that
// keep org themes readable are unit-tested in isolation, mirroring the
// content-lifecycle.ts precedent. The DB-touching helpers live in
// org-branding.ts and call validateBranding() before every write; the theme
// renderer in apps/web trusts rows precisely because nothing else can write
// them.
//
// Policy summary:
//   - Colours: an org picks ONE accent (primary) and ONE dark surface. Every
//     other shade (hover, soft tint, on-accent text) is derived here, never
//     hand-picked — so a theme can't ship a disharmonious or unreadable
//     derived state.
//   - Contrast: saves are rejected unless the four load-bearing pairs clear
//     WCAG thresholds (see MIN_* constants). The platform defaults pass all
//     four; red-on-red or yellow-on-white style palettes cannot.
//   - Fonts: only keys in BRANDING_FONTS are accepted. Every face is SIL-OFL,
//     self-hosted, and ships the full 500 / 700 / 700-italic set the type
//     scale needs — a free-string font can never reach the renderer.

// ─── Font allowlist ────────────────────────────────────────────────────────
//
// `files` maps font weights to the self-hosted woff2 basenames under
// apps/web/public/fonts/. Adding a face here requires adding its files there
// (and confirming the 500/700/700i set exists upstream — Lexend, Manrope and
// Sora were excluded for missing true italics).

export type BrandingFontFace = {
  label: string;
  /** CSS font-family name as registered by our @font-face rules. */
  family: string;
  /** Stack appended after the family. Rubik stays the first fallback so a
   *  failed org-font load degrades to the platform face, not Times. */
  fallback: string;
};

export const BRANDING_FONTS = {
  rubik: { label: "Rubik (default)", family: "Rubik", fallback: "system-ui, sans-serif" },
  nunito: { label: "Nunito", family: "Nunito", fallback: '"Rubik", system-ui, sans-serif' },
  poppins: { label: "Poppins", family: "Poppins", fallback: '"Rubik", system-ui, sans-serif' },
  montserrat: { label: "Montserrat", family: "Montserrat", fallback: '"Rubik", system-ui, sans-serif' },
  "work-sans": { label: "Work Sans", family: "Work Sans", fallback: '"Rubik", system-ui, sans-serif' },
  karla: { label: "Karla", family: "Karla", fallback: '"Rubik", system-ui, sans-serif' },
  jost: { label: "Jost", family: "Jost", fallback: '"Rubik", system-ui, sans-serif' },
  figtree: { label: "Figtree", family: "Figtree", fallback: '"Rubik", system-ui, sans-serif' },
  raleway: { label: "Raleway", family: "Raleway", fallback: '"Rubik", system-ui, sans-serif' },
} as const satisfies Record<string, BrandingFontFace>;

export type BrandingFontKey = keyof typeof BRANDING_FONTS;

export function isBrandingFontKey(raw: unknown): raw is BrandingFontKey {
  return typeof raw === "string" && raw in BRANDING_FONTS;
}

// ─── Colour math (WCAG 2.1) ────────────────────────────────────────────────

export type Rgb = { r: number; g: number; b: number };

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function parseHexColor(raw: unknown): Rgb | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!HEX_RE.test(trimmed)) return null;
  let hex = trimmed.slice(1);
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

export function toHexColor(rgb: Rgb): string {
  const channel = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`.toUpperCase();
}

/** Linear interpolation between two colours; t=0 → a, t=1 → b. */
export function mixColors(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * linearize(rgb.r) +
    0.7152 * linearize(rgb.g) +
    0.0722 * linearize(rgb.b)
  );
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

// ─── Contrast thresholds ───────────────────────────────────────────────────
//
// Calibrated so the platform defaults (#EE2346 accent on white = 4.23:1,
// white on #0A0A0A = 19.8:1) pass, while genuinely unreadable palettes fail.
// The accent is used for CTAs/pills/focus rings (WCAG 1.4.11 non-text = 3:1,
// large bold button labels = 3:1); the dark surface carries body-size nav
// text, so it gets the full 4.5:1 text requirement.

export const MIN_ACCENT_ON_LIGHT = 3;
export const MIN_ACCENT_ON_DARK = 3;
export const MIN_CTA_TEXT_ON_ACCENT = 3;
export const MIN_TEXT_ON_DARK_SURFACE = 4.5;

// ─── Theme shape ───────────────────────────────────────────────────────────

export type BrandingTheme = {
  enabled: boolean;
  primary_color: string;
  surface_dark_color: string;
  font_key: BrandingFontKey;
};

export const DEFAULT_BRANDING: BrandingTheme = {
  enabled: true,
  primary_color: "#EE2346",
  surface_dark_color: "#0A0A0A",
  font_key: "rubik",
};

export type BrandingFailureReason =
  | "invalid_primary_color"
  | "invalid_surface_color"
  | "unknown_font"
  | "accent_unreadable_on_light"
  | "accent_unreadable_on_dark"
  | "cta_text_unreadable"
  | "dark_surface_too_light";

export type BrandingValidation =
  | { ok: true; value: BrandingTheme }
  | { ok: false; reason: BrandingFailureReason };

export type BrandingInput = {
  enabled?: unknown;
  primary_color?: unknown;
  surface_dark_color?: unknown;
  font_key?: unknown;
};

/**
 * The single gate every OrgBranding write must pass. Normalises hex casing
 * and rejects any palette whose load-bearing contrast pairs fall below the
 * MIN_* thresholds. Order of checks is stable so UIs can map reasons to the
 * offending field.
 */
export function validateBranding(input: BrandingInput): BrandingValidation {
  const primary = parseHexColor(input.primary_color);
  if (!primary) return { ok: false, reason: "invalid_primary_color" };

  const surfaceDark = parseHexColor(input.surface_dark_color);
  if (!surfaceDark) return { ok: false, reason: "invalid_surface_color" };

  if (!isBrandingFontKey(input.font_key)) {
    return { ok: false, reason: "unknown_font" };
  }

  if (contrastRatio(WHITE, surfaceDark) < MIN_TEXT_ON_DARK_SURFACE) {
    return { ok: false, reason: "dark_surface_too_light" };
  }
  if (contrastRatio(primary, WHITE) < MIN_ACCENT_ON_LIGHT) {
    return { ok: false, reason: "accent_unreadable_on_light" };
  }
  if (contrastRatio(primary, surfaceDark) < MIN_ACCENT_ON_DARK) {
    return { ok: false, reason: "accent_unreadable_on_dark" };
  }
  const onPrimary = pickOnPrimary(primary);
  if (contrastRatio(onPrimary, primary) < MIN_CTA_TEXT_ON_ACCENT) {
    return { ok: false, reason: "cta_text_unreadable" };
  }

  return {
    ok: true,
    value: {
      enabled: input.enabled === undefined ? true : input.enabled === true,
      primary_color: toHexColor(primary),
      surface_dark_color: toHexColor(surfaceDark),
      font_key: input.font_key,
    },
  };
}

// ─── Derived palette ───────────────────────────────────────────────────────

export type DerivedPalette = {
  /** The accent itself. */
  primary: string;
  /** Hover/active shade — accent mixed 18% toward black (matches the
   *  hand-tuned #EE2346 → #CC1239 relationship closely enough). */
  primaryDark: string;
  /** Tinted background for alerts/soft chips — accent mixed 92% toward white. */
  primarySoft: string;
  /** CTA label colour on the accent: white or black, whichever reads better. */
  onPrimary: string;
  /** The org's dark chrome surface. */
  surfaceDark: string;
};

function pickOnPrimary(primary: Rgb): Rgb {
  // Prefer white whenever it's readable: WCAG arithmetic slightly favours
  // black on saturated mid-tones (black on #EE2346 scores 4.97 vs white's
  // 4.23) but white-on-accent is the established CTA treatment — only drop
  // to black when white genuinely can't clear the threshold.
  return contrastRatio(WHITE, primary) >= MIN_CTA_TEXT_ON_ACCENT
    ? WHITE
    : BLACK;
}

export function deriveBrandingPalette(theme: BrandingTheme): DerivedPalette {
  // validateBranding() guarantees parseable colours; the non-null assertions
  // here are safe for any theme that came through it (or DEFAULT_BRANDING).
  const primary = parseHexColor(theme.primary_color);
  const surfaceDark = parseHexColor(theme.surface_dark_color);
  if (!primary || !surfaceDark) {
    throw new Error("deriveBrandingPalette: theme has unparseable colours");
  }
  return {
    primary: toHexColor(primary),
    primaryDark: toHexColor(mixColors(primary, BLACK, 0.18)),
    primarySoft: toHexColor(mixColors(primary, WHITE, 0.92)),
    onPrimary: toHexColor(pickOnPrimary(primary)),
    surfaceDark: toHexColor(surfaceDark),
  };
}

// ─── CSS variable mapping ──────────────────────────────────────────────────
//
// tokens.css exposes every brand utility through :root custom properties and
// `@theme inline`, so retoning an org's surfaces is exactly "override these
// variables on the layout wrapper". This map is the ONLY bridge between
// OrgBranding rows and CSS — keep it in lockstep with
// packages/ui/src/tokens.css.

export function brandingCssVariables(
  theme: BrandingTheme,
): Record<string, string> {
  const palette = deriveBrandingPalette(theme);
  const font = BRANDING_FONTS[theme.font_key];
  const family = `"${font.family}", ${font.fallback}`;
  return {
    "--brand-red": palette.primary,
    "--brand-red-dark": palette.primaryDark,
    "--brand-red-soft": palette.primarySoft,
    "--brand-black": palette.surfaceDark,
    "--brand-font-display": family,
    "--brand-font-heading": family,
    "--brand-font-body": family,
  };
}

/** Serialises the override map into a `style=""`-safe declaration list. */
export function brandingStyleAttribute(theme: BrandingTheme): string {
  return Object.entries(brandingCssVariables(theme))
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

// ─── Row → theme resolution ────────────────────────────────────────────────

export type BrandingRowShape = {
  enabled: boolean;
  primary_color: string;
  surface_dark_color: string;
  font_key: string;
} | null;

/**
 * Resolves a stored OrgBranding row to the theme a surface should render.
 * Bulletproof by construction: a missing row, a disabled row, or a row that
 * somehow no longer passes validation (e.g. a font retired from the
 * allowlist) all fall back to the platform default rather than rendering a
 * broken theme.
 */
export function resolveBrandingTheme(row: BrandingRowShape): BrandingTheme {
  if (!row || !row.enabled) return DEFAULT_BRANDING;
  const checked = validateBranding(row);
  return checked.ok ? checked.value : DEFAULT_BRANDING;
}
