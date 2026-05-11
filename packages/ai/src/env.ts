// Lazy env accessors for the AI gateway.
//
// Why lazy: importing the gateway must not throw if a key is missing — only
// the call site that actually needs the provider should fail. This keeps
// unit tests, type checks, and the Next.js build green without the keys.
//
// Why a shared .env at packages/db/.env: the user keeps DATABASE_URL + AI
// keys together (one secret store for local dev). Next.js does not look
// there by default, so the gateway loads it explicitly the first time an
// env var is requested. In Vercel / CI, process.env is populated by the
// platform and the dotenv call is a no-op.

import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let envLoaded = false;

function ensureLoaded() {
  if (envLoaded) return;
  const here = dirname(fileURLToPath(import.meta.url));
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
