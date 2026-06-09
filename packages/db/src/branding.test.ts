import { describe, expect, it } from "vitest";
import {
  BRANDING_FONTS,
  DEFAULT_BRANDING,
  MIN_ACCENT_ON_DARK,
  MIN_ACCENT_ON_LIGHT,
  MIN_TEXT_ON_DARK_SURFACE,
  brandingCssVariables,
  brandingStyleAttribute,
  contrastRatio,
  deriveBrandingPalette,
  parseHexColor,
  resolveBrandingTheme,
  toHexColor,
  validateBranding,
} from "./branding";

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

describe("parseHexColor", () => {
  it("parses #RRGGBB", () => {
    expect(parseHexColor("#EE2346")).toEqual({ r: 238, g: 35, b: 70 });
  });

  it("parses shorthand #RGB by doubling digits", () => {
    expect(parseHexColor("#F0A")).toEqual({ r: 255, g: 0, b: 170 });
  });

  it("tolerates surrounding whitespace and lowercase", () => {
    expect(parseHexColor("  #ee2346 ")).toEqual({ r: 238, g: 35, b: 70 });
  });

  it.each(["EE2346", "#EE234", "#GG0000", "", null, 42, undefined])(
    "rejects %p",
    (raw) => {
      expect(parseHexColor(raw)).toBeNull();
    },
  );
});

describe("contrastRatio", () => {
  it("white vs black is 21:1", () => {
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 5);
  });

  it("identical colours are 1:1 and order doesn't matter", () => {
    const red = parseHexColor("#EE2346")!;
    expect(contrastRatio(red, red)).toBeCloseTo(1, 5);
    expect(contrastRatio(red, WHITE)).toBeCloseTo(
      contrastRatio(WHITE, red),
      10,
    );
  });
});

describe("validateBranding", () => {
  const good = {
    primary_color: "#EE2346",
    surface_dark_color: "#0A0A0A",
    font_key: "rubik",
  };

  it("accepts the platform defaults (the thresholds must never exclude our own brand)", () => {
    const result = validateBranding(good);
    expect(result).toEqual({
      ok: true,
      value: {
        enabled: true,
        primary_color: "#EE2346",
        surface_dark_color: "#0A0A0A",
        font_key: "rubik",
      },
    });
  });

  it("normalises lowercase + shorthand hex to uppercase #RRGGBB", () => {
    const result = validateBranding({
      ...good,
      primary_color: "#085",
      surface_dark_color: "#111111",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.primary_color).toBe("#008855");
      expect(result.value.surface_dark_color).toBe("#111111");
    }
  });

  it("accepts every font on the allowlist", () => {
    for (const key of Object.keys(BRANDING_FONTS)) {
      expect(validateBranding({ ...good, font_key: key }).ok).toBe(true);
    }
  });

  it("rejects a malformed primary colour", () => {
    expect(validateBranding({ ...good, primary_color: "red" })).toEqual({
      ok: false,
      reason: "invalid_primary_color",
    });
  });

  it("rejects a malformed surface colour", () => {
    expect(
      validateBranding({ ...good, surface_dark_color: "#12345" }),
    ).toEqual({ ok: false, reason: "invalid_surface_color" });
  });

  it("rejects a font that isn't on the allowlist", () => {
    expect(validateBranding({ ...good, font_key: "comic-sans" })).toEqual({
      ok: false,
      reason: "unknown_font",
    });
  });

  it("rejects a dark surface too light to carry white nav text", () => {
    expect(
      validateBranding({ ...good, surface_dark_color: "#BBBBBB" }),
    ).toEqual({ ok: false, reason: "dark_surface_too_light" });
  });

  it("rejects a pale accent that vanishes on white surfaces", () => {
    expect(validateBranding({ ...good, primary_color: "#FFE680" })).toEqual({
      ok: false,
      reason: "accent_unreadable_on_light",
    });
  });

  it("rejects red-on-red: accent identical to the dark surface", () => {
    expect(
      validateBranding({
        ...good,
        primary_color: "#8B1A2F",
        surface_dark_color: "#8B1A2F",
      }),
    ).toEqual({ ok: false, reason: "accent_unreadable_on_dark" });
  });

  it("treats enabled as true unless explicitly false-ish", () => {
    const off = validateBranding({ ...good, enabled: false });
    expect(off.ok && !off.value.enabled).toBe(true);
    const on = validateBranding({ ...good, enabled: undefined });
    expect(on.ok && on.value.enabled).toBe(true);
  });
});

describe("deriveBrandingPalette", () => {
  it("derives the full palette from the defaults", () => {
    const palette = deriveBrandingPalette(DEFAULT_BRANDING);
    expect(palette.primary).toBe("#EE2346");
    expect(palette.surfaceDark).toBe("#0A0A0A");
    // White reads better than black on our red.
    expect(palette.onPrimary).toBe("#FFFFFF");
    // Hover shade is genuinely darker; soft tint genuinely lighter.
    const primary = parseHexColor(palette.primary)!;
    const dark = parseHexColor(palette.primaryDark)!;
    const soft = parseHexColor(palette.primarySoft)!;
    expect(contrastRatio(dark, BLACK)).toBeLessThan(
      contrastRatio(primary, BLACK),
    );
    expect(contrastRatio(soft, WHITE)).toBeLessThan(1.2);
  });

  it("picks black CTA text on a light-leaning accent", () => {
    const palette = deriveBrandingPalette({
      ...DEFAULT_BRANDING,
      primary_color: "#F2A900", // amber — black text reads far better
    });
    expect(palette.onPrimary).toBe("#000000");
  });

  it("round-trips hex casing through toHexColor", () => {
    expect(toHexColor(parseHexColor("#aabbcc")!)).toBe("#AABBCC");
  });
});

describe("brandingCssVariables", () => {
  it("maps the default theme onto the tokens.css variable names", () => {
    const vars = brandingCssVariables(DEFAULT_BRANDING);
    expect(vars["--brand-red"]).toBe("#EE2346");
    expect(vars["--brand-black"]).toBe("#0A0A0A");
    expect(vars["--brand-font-body"]).toContain("Rubik");
  });

  it("keeps Rubik as the fallback for a non-default font", () => {
    const vars = brandingCssVariables({
      ...DEFAULT_BRANDING,
      font_key: "poppins",
    });
    expect(vars["--brand-font-display"]).toBe(
      '"Poppins", "Rubik", system-ui, sans-serif',
    );
  });

  it("serialises to a style-attribute declaration list", () => {
    const style = brandingStyleAttribute(DEFAULT_BRANDING);
    expect(style).toContain("--brand-red: #EE2346");
    expect(style.split("; ").length).toBe(
      Object.keys(brandingCssVariables(DEFAULT_BRANDING)).length,
    );
  });
});

describe("resolveBrandingTheme", () => {
  const row = {
    enabled: true,
    primary_color: "#2E8B57",
    surface_dark_color: "#10231B",
    font_key: "nunito",
  };

  it("returns the platform default for a missing row", () => {
    expect(resolveBrandingTheme(null)).toEqual(DEFAULT_BRANDING);
  });

  it("returns the platform default for a disabled row", () => {
    expect(resolveBrandingTheme({ ...row, enabled: false })).toEqual(
      DEFAULT_BRANDING,
    );
  });

  it("returns the stored theme when valid", () => {
    expect(resolveBrandingTheme(row)).toEqual({ ...row, enabled: true });
  });

  it("falls back to the default when a stored row no longer validates (e.g. retired font)", () => {
    expect(resolveBrandingTheme({ ...row, font_key: "lexend" })).toEqual(
      DEFAULT_BRANDING,
    );
  });
});

describe("threshold sanity", () => {
  it("the documented platform-default ratios clear every gate", () => {
    const red = parseHexColor("#EE2346")!;
    const dark = parseHexColor("#0A0A0A")!;
    expect(contrastRatio(red, WHITE)).toBeGreaterThanOrEqual(
      MIN_ACCENT_ON_LIGHT,
    );
    expect(contrastRatio(red, dark)).toBeGreaterThanOrEqual(
      MIN_ACCENT_ON_DARK,
    );
    expect(contrastRatio(WHITE, dark)).toBeGreaterThanOrEqual(
      MIN_TEXT_ON_DARK_SURFACE,
    );
  });
});
