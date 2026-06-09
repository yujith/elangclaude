// Self-hosted @font-face CSS for the org-branding font allowlist (ADR-0023).
//
// Files live in apps/web/public/fonts/ and mirror the Rubik setup in
// globals.css: one variable woff2 spanning the upright weight axis plus an
// italic woff2 (Poppins is the exception — Google Fonts ships it as static
// weights only, so it gets three faces). Latin subset only, same as Rubik.
//
// Rubik itself returns null here: its faces are already declared globally in
// globals.css, and the platform default must not emit a second copy.

import type { BrandingFontKey } from "@elc/db/branding";

type FontFace = {
  file: string;
  style: "normal" | "italic";
  /** CSS font-weight value — a range for variable fonts. */
  weight: string;
};

const FACES: Record<Exclude<BrandingFontKey, "rubik">, FontFace[]> = {
  nunito: [
    { file: "nunito-variable.woff2", style: "normal", weight: "200 1000" },
    { file: "nunito-italic.woff2", style: "italic", weight: "200 1000" },
  ],
  poppins: [
    { file: "poppins-medium.woff2", style: "normal", weight: "500" },
    { file: "poppins-bold.woff2", style: "normal", weight: "700" },
    { file: "poppins-italic-bold.woff2", style: "italic", weight: "700" },
  ],
  montserrat: [
    { file: "montserrat-variable.woff2", style: "normal", weight: "100 900" },
    { file: "montserrat-italic.woff2", style: "italic", weight: "100 900" },
  ],
  "work-sans": [
    { file: "work-sans-variable.woff2", style: "normal", weight: "100 900" },
    { file: "work-sans-italic.woff2", style: "italic", weight: "100 900" },
  ],
  karla: [
    { file: "karla-variable.woff2", style: "normal", weight: "200 800" },
    { file: "karla-italic.woff2", style: "italic", weight: "200 800" },
  ],
  jost: [
    { file: "jost-variable.woff2", style: "normal", weight: "100 900" },
    { file: "jost-italic.woff2", style: "italic", weight: "100 900" },
  ],
  figtree: [
    { file: "figtree-variable.woff2", style: "normal", weight: "300 900" },
    { file: "figtree-italic.woff2", style: "italic", weight: "300 900" },
  ],
  raleway: [
    { file: "raleway-variable.woff2", style: "normal", weight: "100 900" },
    { file: "raleway-italic.woff2", style: "italic", weight: "100 900" },
  ],
};

const FAMILY_NAMES: Record<Exclude<BrandingFontKey, "rubik">, string> = {
  nunito: "Nunito",
  poppins: "Poppins",
  montserrat: "Montserrat",
  "work-sans": "Work Sans",
  karla: "Karla",
  jost: "Jost",
  figtree: "Figtree",
  raleway: "Raleway",
};

export function orgFontFaceCss(key: BrandingFontKey): string | null {
  if (key === "rubik") return null;
  const family = FAMILY_NAMES[key];
  return FACES[key]
    .map(
      (face) =>
        `@font-face { font-family: "${family}"; font-style: ${face.style}; ` +
        `font-weight: ${face.weight}; font-display: swap; ` +
        `src: url("/fonts/${face.file}") format("woff2"); }`,
    )
    .join("\n");
}

/** Upright file(s) worth preloading — the italic loads on demand. */
export function orgFontPreloadPaths(key: BrandingFontKey): string[] {
  if (key === "rubik") return [];
  return FACES[key]
    .filter((face) => face.style === "normal")
    .map((face) => `/fonts/${face.file}`);
}
