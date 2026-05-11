// Mirrors packages/db/src/test-setup.ts: load the shared .env so any test
// touching env-dependent code (gateway, env loader) sees the same keys the
// app uses at runtime. Tests in this package mock providers and Prisma — we
// do NOT hit real APIs or a real DB here.

import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../db/.env") });
