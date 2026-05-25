// E2E: accessibility check on the public auth pages.
//
// /sign-in and /sign-up render Clerk's hosted widget inside our brand
// shell. Clerk produces accessible markup, but the shell (the black
// hero, the form-pane wrapper, the appearance overrides on form-field
// labels and dividers) is ours — we want axe to catch any contrast or
// landmark regression we introduce.
//
// Scope: WCAG 2.1 A + AA rules only, matching .claude/rules/architecture.md.
// We do NOT scan the Clerk widget's own DOM subtree (too noisy and not
// owned by us); we focus on the page chrome via include selectors.

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("auth a11y", () => {
  test("/sign-in has no detectable axe violations", async ({ page }) => {
    await page.goto("/sign-in");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(
      results.violations,
      `axe violations on /sign-in:\n${JSON.stringify(results.violations, null, 2)}`,
    ).toEqual([]);
  });

  test("/sign-up has no detectable axe violations", async ({ page }) => {
    await page.goto("/sign-up");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(
      results.violations,
      `axe violations on /sign-up:\n${JSON.stringify(results.violations, null, 2)}`,
    ).toEqual([]);
  });
});
