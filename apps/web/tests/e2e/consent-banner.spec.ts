// E2E regression: the consent banner must not crash a page when a consent
// cookie already exists.
//
// Bug history: ConsentBanner read the cookie via useSyncExternalStore with a
// getSnapshot that re-parsed the cookie into a fresh object every call. With
// NO cookie it returned a stable `null` (so a fresh browser was fine — and our
// other e2e tests never set the cookie), but once a cookie existed it returned
// a new object reference each render, so React saw the store "change" on every
// render and threw "Maximum update depth exceeded" (React #185) — every page
// rendered the global error boundary ("This page couldn't load"). This guards
// the cached-snapshot fix.

import { test, expect } from "@playwright/test";

const CONSENT_COOKIE = "elc_consent";

test.describe("consent banner regression", () => {
  test("a page renders normally when a consent cookie is already set", async ({
    page,
    context,
  }) => {
    const choice = {
      v: "cookies@2026-06-01",
      functional: true,
      analytics: false,
      ts: new Date().toISOString(),
    };
    await context.addCookies([
      {
        name: CONSENT_COOKIE,
        value: encodeURIComponent(JSON.stringify(choice)),
        domain: "localhost",
        path: "/",
      },
    ]);

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/sign-in");

    // The global error boundary fallback must NOT be showing.
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);
    // Our auth shell headline renders (page is actually alive).
    await expect(page.getByText("Skills That Open Doorways.")).toBeVisible();
    // No render-loop crash bubbled up.
    expect(
      pageErrors.join("\n"),
      `unexpected page errors:\n${pageErrors.join("\n")}`,
    ).not.toMatch(/Maximum update depth|Minified React error #185/);
  });
});
