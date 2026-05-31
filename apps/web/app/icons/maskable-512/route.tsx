import { ImageResponse } from "next/og";
import { brandIconElement } from "@/lib/pwa/brand-icon";

// PWA manifest icon — 512px, purpose "maskable". The mark is pulled in to
// ~56% so it survives the platform's circular/squircle mask (inner-80% safe
// zone). Prerendered as a static asset for service-worker caching.
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(brandIconElement({ size: 512, markFraction: 0.56 }), {
    width: 512,
    height: 512,
  });
}
