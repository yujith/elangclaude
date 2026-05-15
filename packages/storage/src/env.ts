// Lazy env accessors for @elc/storage.
//
// Same pattern (and same reasoning) as packages/ai/src/env.ts: importing the
// storage package must not throw if a key is missing — only the callsite that
// actually mints a signed URL or downloads an object should fail. This keeps
// unit tests, type checks, and the Next.js build green without R2 credentials.
//
// The shared local secret store is packages/db/.env; Next.js does not look
// there by default, so we load it explicitly the first time a var is read.
// In Vercel / CI, process.env is populated by the platform and the dotenv
// call is a harmless no-op.

import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let envLoaded = false;

function ensureLoaded(): void {
  if (envLoaded) return;
  const here = dirname(fileURLToPath(import.meta.url));
  // packages/storage/src → ../../db/.env
  loadEnv({ path: resolve(here, "../../db/.env") });
  envLoaded = true;
}

export function readEnv(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  ensureLoaded();
  return process.env[name];
}

export function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Add it to packages/db/.env (the shared local secret store).`,
    );
  }
  return value;
}
