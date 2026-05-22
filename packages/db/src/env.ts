// Lazy load packages/db/.env so Next.js (which only reads apps/web/.env by
// default) still gets DATABASE_URL when importing @elc/db/client.

import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let envLoaded = false;

function ensureLoaded(): void {
  if (envLoaded) return;
  const here = dirname(fileURLToPath(import.meta.url));
  loadEnv({ path: resolve(here, "../.env") });
  envLoaded = true;
}

export function readEnv(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  ensureLoaded();
  return process.env[name];
}

/** Neon pooler URLs need pgbouncer=true for Prisma; add safe defaults if missing. */
export function resolveDatabaseUrl(): string | undefined {
  const raw = readEnv("DATABASE_URL");
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    if (url.hostname.includes("pooler") && !url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
    }
    if (!url.searchParams.has("connect_timeout")) {
      url.searchParams.set("connect_timeout", "15");
    }
    return url.toString();
  } catch {
    return raw;
  }
}
