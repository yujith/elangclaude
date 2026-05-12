// Runs once per `vitest run` invocation. Applies any pending migrations to
// the Neon test branch so a fresh checkout doesn't have to remember to do it
// manually. We do not seed here — every test file resets data itself.

import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Neon's pooler endpoint (hostname includes "-pooler") is fine for runtime
// queries but unreliable for `pg_advisory_lock`, which Prisma uses to
// serialise `migrate deploy`. Symptom: P1002 timeouts after 10s. The
// supported workaround is to run migrations against the DIRECT host
// (same branch, no "-pooler" suffix) while keeping the test runtime on
// the pooler URL. We derive the direct URL by stripping the suffix.
//
// See https://pris.ly/d/migrate-advisory-locking and
// https://neon.tech/docs/connect/connection-pooling#use-the-pgbouncer-flag
function directUrlFromPooled(url: string): string {
  return url.replace(/-pooler(?=\.[^.]+\.aws\.neon\.tech)/, "");
}

export default async function globalSetup() {
  loadEnv({ path: resolve(here, "../.env") });

  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) {
    throw new Error(
      "DATABASE_URL_TEST is not set. Add it to packages/db/.env — see " +
        "packages/db/README.md for the Neon test-branch setup.",
    );
  }
  const directUrl = directUrlFromPooled(testUrl);
  const cwd = resolve(here, "..");
  const migrateEnv = { ...process.env, DATABASE_URL: directUrl };

  // First check whether any migrations are pending. `prisma migrate status`
  // is a read-only check that does NOT acquire the advisory lock, so it
  // never trips Neon's P1002 timeout even when a stale lock is held. Only
  // call `migrate deploy` (which DOES take the lock) when we actually have
  // work to do. This makes the 20×-fuzzer ship-gate sweep deterministic.
  let needsDeploy = true;
  try {
    execSync("pnpm prisma migrate status", {
      cwd,
      env: migrateEnv,
      stdio: "pipe", // capture; we don't need to print "Database schema is up to date!" twenty times
    });
    needsDeploy = false; // exit 0 = up to date
  } catch {
    // Non-zero exit = pending migrations exist (or status itself failed —
    // in which case `migrate deploy` will give the same error with a more
    // useful message).
    needsDeploy = true;
  }

  if (!needsDeploy) return;

  // We route migration traffic through the direct (non-pooler) host to
  // avoid Neon pooler's known unreliability with `pg_advisory_lock`.
  // See https://pris.ly/d/migrate-advisory-locking.
  execSync("pnpm prisma migrate deploy", {
    cwd,
    env: migrateEnv,
    stdio: "inherit",
  });
}
