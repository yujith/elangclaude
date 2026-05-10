// Runs once per `vitest run` invocation. Applies any pending migrations to
// the Neon test branch so a fresh checkout doesn't have to remember to do it
// manually. We do not seed here — every test file resets data itself.

import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  loadEnv({ path: resolve(here, "../.env") });

  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) {
    throw new Error(
      "DATABASE_URL_TEST is not set. Add it to packages/db/.env — see " +
        "packages/db/README.md for the Neon test-branch setup.",
    );
  }

  // `prisma migrate deploy` is non-interactive and idempotent — applies any
  // committed migrations not yet present on the branch. It does NOT reset
  // data, which is what we want.
  execSync("pnpm prisma migrate deploy", {
    cwd: resolve(here, ".."),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "inherit",
  });
}
