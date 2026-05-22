import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "./env";

// Singleton guard. Next.js dev mode HMR re-evaluates modules on every save —
// without the global cache we'd leak a fresh PrismaClient (and its connection
// pool) on every change.

declare global {
  // eslint-disable-next-line no-var
  var __elc_prisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const url = resolveDatabaseUrl();
  return new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    log:
      process.env.NODE_ENV === "production"
        ? ["error"]
        : ["warn", "error"],
  });
}

export const prisma: PrismaClient =
  globalThis.__elc_prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__elc_prisma = prisma;
}
