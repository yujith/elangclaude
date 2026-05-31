import { ImageResponse } from "next/og";
import { brandIconElement } from "@/lib/pwa/brand-icon";

// Apple touch icon. iOS applies its own rounded-corner mask and ignores
// transparency, so we render the mark on a solid white plate.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(brandIconElement({ size: 180, markFraction: 0.66 }), { ...size });
}
