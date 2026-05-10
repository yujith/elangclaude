// Runs before every test file. Must NOT import the Prisma client — the env
// rewrite below has to land before any module reads `DATABASE_URL`.

import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../.env") });

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  throw new Error(
    "DATABASE_URL_TEST is not set. Add it to packages/db/.env — see " +
      "packages/db/README.md for the Neon test-branch setup.",
  );
}

// Force Prisma to point at the dedicated test branch. Done at module load
// (before any test imports `./client.js`) so the singleton is created with
// the right URL.
process.env.DATABASE_URL = testUrl;
