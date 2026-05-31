import { ImageResponse } from "next/og";
import { brandIconElement } from "@/lib/pwa/brand-icon";

// PWA manifest icon — 192px, purpose "any". Prerendered as a static asset so
// the service worker can cache-first it like any other public file.
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(brandIconElement({ size: 192, markFraction: 0.72 }), {
    width: 192,
    height: 192,
  });
}
