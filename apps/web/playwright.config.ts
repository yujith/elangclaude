// Playwright config for apps/web. First wired in for the suspend-gate
// suite (Phase 5 follow-up); add more `tests/e2e/*.spec.ts` files as
// the suite grows.
//
// `webServer` spawns `pnpm dev` automatically when you run
// `pnpm test:e2e` from apps/web. It reuses an already-running dev
// server if one is up on port 3000.
//
// Run locally:
//   cd apps/web
//   pnpm exec playwright install chromium   # one-time browser fetch
//   pnpm test:e2e
//
// In CI Playwright starts a fresh dev server; locally it reuses an
// existing server when one is already running on the configured port.

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3000);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Each spec spins up its own DB fixtures; running specs in parallel
  // would race on the shared schema until we add per-test isolation.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
