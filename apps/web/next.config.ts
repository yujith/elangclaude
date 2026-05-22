import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Mirror the env strategy used by packages/db and packages/ai: all
// secrets live in packages/db/.env (the shared local secret store).
// We load that file into process.env here so Clerk's middleware and
// any other SDK that reads process.env directly (no dotenv glue of
// its own) picks up NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY,
// CLERK_WEBHOOK_SIGNING_SECRET, etc. Without this the Next.js process
// only sees apps/web/.env.local — which we deliberately keep empty.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../packages/db/.env") });

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
