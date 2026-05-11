// Quota gate.
//
// Contract: reserveQuota() atomically increments `QuotaUsage.ai_calls_count`
// for (user_id, date=today). If the post-increment value exceeds the org's
// `quota_daily`, it decrements and throws QuotaExceededError. Otherwise the
// call proceeds — the AI request itself happens AFTER the reservation, and
// if the provider call fails the caller can refundQuota() to release the
// reservation.
//
// Two concurrent gateway calls cannot both slip past the limit:
//   - Prisma's `increment` atomic operator serializes the read-modify-write
//     at the DB layer.
//   - The post-increment value is what we compare, so if both calls land
//     at limit+1 and limit+2, both refund. Net: at most `quota_daily` calls
//     survive, matching the contract.
//
// Why a small `db` interface instead of importing `withOrg(ctx)` directly:
// the gateway is the only legitimate caller, and the gateway is unit-tested
// with a mock. Keeping the dependency explicit makes the test small and
// makes the gateway's behaviour easy to verify in isolation.

import type { OrgContext } from "@elc/db";
import { QuotaExceededError } from "./errors";

export type QuotaDb = {
  organization: {
    findUniqueOrThrow(args: {
      where: { id: string };
      select: { quota_daily: true };
    }): Promise<{ quota_daily: number }>;
  };
  quotaUsage: {
    upsert(args: {
      where: { user_id_date: { user_id: string; date: Date } };
      create: {
        user_id: string;
        date: Date;
        ai_calls_count: number;
      };
      update: { ai_calls_count: { increment: number } };
      select: { ai_calls_count: true };
    }): Promise<{ ai_calls_count: number }>;
    update(args: {
      where: { user_id_date: { user_id: string; date: Date } };
      data: { ai_calls_count: { decrement: number } | { increment: number } };
    }): Promise<unknown>;
  };
};

export function todayUtc(): Date {
  const now = new Date();
  // Quota windows are UTC midnight → midnight. Storing as a Date column
  // (Prisma @db.Date) truncates to date-only at write time; we explicitly
  // normalize here so the read in the test layer is deterministic.
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export async function reserveQuota(
  db: QuotaDb,
  ctx: OrgContext,
  now: Date = todayUtc(),
): Promise<void> {
  const org = await db.organization.findUniqueOrThrow({
    where: { id: ctx.org_id },
    select: { quota_daily: true },
  });

  const after = await db.quotaUsage.upsert({
    where: { user_id_date: { user_id: ctx.user_id, date: now } },
    create: { user_id: ctx.user_id, date: now, ai_calls_count: 1 },
    update: { ai_calls_count: { increment: 1 } },
    select: { ai_calls_count: true },
  });

  if (after.ai_calls_count > org.quota_daily) {
    await db.quotaUsage.update({
      where: { user_id_date: { user_id: ctx.user_id, date: now } },
      data: { ai_calls_count: { decrement: 1 } },
    });
    throw new QuotaExceededError(
      ctx.user_id,
      after.ai_calls_count - 1,
      org.quota_daily,
    );
  }
}

export async function refundQuota(
  db: QuotaDb,
  ctx: OrgContext,
  now: Date = todayUtc(),
): Promise<void> {
  // Best-effort; if this fails we'd rather not mask the original error.
  try {
    await db.quotaUsage.update({
      where: { user_id_date: { user_id: ctx.user_id, date: now } },
      data: { ai_calls_count: { decrement: 1 } },
    });
  } catch {
    // Swallow. A leaked reservation costs at most one slot until midnight.
  }
}
