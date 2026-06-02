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

// Monorepo root (apps/web → ../..). Pinned explicitly so Next's file
// tracer roots the standalone output at the workspace root rather than
// guessing — this is what makes traced repo-root files land under
// `/var/task/<path>` on Vercel.
const monorepoRoot = resolve(here, "../..");

const nextConfig: NextConfig = {
  // Force the repo-root `prompts/**` markdown into the serverless function
  // bundle. The AI prompt loaders (packages/ai/src/{generation,grading}/
  // prompts.ts) read these at runtime via a computed `readFileSync` path,
  // which the static tracer can't follow — so without this the files are
  // absent in production and every generate/grade call dies with ENOENT
  // (`/var/task/prompts/generation/*.md`), surfacing as `generate_error=unknown`.
  // The loaders already resolve to `<root>/prompts/...`, which maps to
  // `/var/task/prompts/...` once tracing places the files there.
  outputFileTracingRoot: monorepoRoot,
  outputFileTracingIncludes: {
    // Glob is resolved relative to the project dir (apps/web) — the build
    // tracer globs with `cwd: <app dir>` — so reach up to the repo root.
    // `outputFileTracingRoot` then roots the copied output at the repo
    // root, placing these at `<root>/prompts/...` → `/var/task/prompts/...`.
    "/**": ["../../prompts/**/*.md"],
  },
};

export default nextConfig;
