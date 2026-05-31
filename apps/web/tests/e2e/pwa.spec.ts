// E2E: PWA public surfaces — offline fallback page, web app manifest, and the
// generated icon routes. These are all public (no auth/DB), so unlike the rest
// of the suite this spec needs no dev-session cookie or fixtures.
//
// Note: the service worker itself only registers in a production build
// (components/pwa/service-worker-registration.tsx), so we don't exercise true
// offline behaviour here — the SW caching policy is covered by the unit guard
// test at tests/unit/sw-cache-policy.test.mjs.

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("PWA surfaces", () => {
  test("offline fallback page renders with a retry action", async ({ page }) => {
    await page.goto("/offline");
    await expect(page.getByRole("heading", { name: /you're offline/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
  });

  test("offline page has no WCAG 2.1 AA violations", async ({ page }) => {
    await page.goto("/offline");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("web app manifest is served with brand tokens and icons", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBeTruthy();
    const manifest = await res.json();
    expect(manifest.name).toBe("eLanguage Center");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#EE2346");
    expect(manifest.start_url).toBe("/");

    const purposes = manifest.icons.map((i: { purpose?: string }) => i.purpose);
    expect(purposes).toContain("maskable");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  });

  test("generated icon routes return PNGs", async ({ request }) => {
    for (const path of ["/icons/icon-192", "/icons/icon-512", "/icons/maskable-512"]) {
      const res = await request.get(path);
      expect(res.ok(), `${path} should 200`).toBeTruthy();
      expect(res.headers()["content-type"]).toContain("image/png");
    }
  });
});
