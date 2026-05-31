import type { ReactElement } from "react";

/**
 * Shared renderer for every PWA / favicon / Apple-touch icon.
 *
 * We can't pre-rasterize the brand mark on this machine (no sharp/ImageMagick/
 * rsvg in the toolchain), so all icons are generated at request time with
 * Next's built-in `ImageResponse` (Satori). Satori only renders a subset of
 * SVG reliably, so rather than feed it the raw `public/brand/icon.svg` we
 * reconstruct the four-square checker mark with absolutely-positioned divs —
 * which Satori rasterizes crisply at any size.
 *
 * Brand tokens are inlined here on purpose: `ImageResponse` runs in the Edge/
 * Satori sandbox and can't read our CSS custom properties.
 */
const BRAND_RED = "#EE2346";
const BRAND_WHITE = "#FFFFFF";

// Each square, normalized to a 0..1 box, derived from the source viewBox
// "65 188 395 395" in public/brand/icon.svg (span = 395 units, square = 140.4,
// corner radius = 19.97 → 14.2% of the square).
const SQUARES = [
  { x: 0.0177, y: 0.0169 }, // top-left
  { x: 0.6245, y: 0.0169 }, // top-right
  { x: 0.3311, y: 0.3226 }, // centre
  { x: 0.0177, y: 0.6264 }, // bottom-left
];
const SQUARE_SIZE = 0.3554; // fraction of the mark box
const SQUARE_RADIUS = 0.1422; // fraction of the square's own side

export type BrandIconOptions = {
  /** Output canvas side length in px (square). */
  size: number;
  /**
   * Fraction of the canvas the mark occupies. Lower = more padding.
   * Use ~0.56 for maskable icons so the mark stays inside the inner-80%
   * safe zone after platform masking; ~0.72 for everything else.
   */
  markFraction?: number;
  background?: string;
  markColor?: string;
};

/** Builds the `ImageResponse` element for a single brand icon. */
export function brandIconElement({
  size,
  markFraction = 0.72,
  background = BRAND_WHITE,
  markColor = BRAND_RED,
}: BrandIconOptions): ReactElement {
  const markSize = Math.round(size * markFraction);
  const squarePx = markSize * SQUARE_SIZE;
  const radiusPx = squarePx * SQUARE_RADIUS;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background,
      }}
    >
      <div style={{ position: "relative", width: markSize, height: markSize, display: "flex" }}>
        {SQUARES.map((sq, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: markSize * sq.x,
              top: markSize * sq.y,
              width: squarePx,
              height: squarePx,
              borderRadius: radiusPx,
              background: markColor,
            }}
          />
        ))}
      </div>
    </div>
  );
}
