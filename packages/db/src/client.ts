import { PrismaClient } from "@prisma/client";

// Singleton guard. Next.js dev mode HMR re-evaluates modules on every save —
// without the global cache we'd leak a fresh PrismaClient (and its connection
// pool) on every change.

declare global {
  // eslint-disable-next-line no-var
  var __elc_prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__elc_prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "production"
        ? ["error"]
        : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__elc_prisma = prisma;
}
