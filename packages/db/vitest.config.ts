import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./src/test-global-setup.ts"],
    setupFiles: ["./src/test-setup.ts"],
    // Tenancy tests share a single Postgres branch — keep them serial so
    // truncates and seed inserts don't collide across files.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
