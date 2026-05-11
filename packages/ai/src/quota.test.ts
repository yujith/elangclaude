import { describe, expect, it, vi } from "vitest";
import { QuotaExceededError } from "./errors";
import { refundQuota, reserveQuota, todayUtc, type QuotaDb } from "./quota";

const CTX = { org_id: "org_1", user_id: "user_1", role: "Learner" as const };
const TODAY = todayUtc();

function makeDb(opts: {
  quotaDaily: number;
  countAfterUpsert: number;
}): QuotaDb & {
  __upsertCalls: number;
  __updateCalls: Array<"increment" | "decrement">;
} {
  const calls = { upsert: 0, updates: [] as Array<"increment" | "decrement"> };
  return {
    organization: {
      findUniqueOrThrow: vi.fn(async () => ({ quota_daily: opts.quotaDaily })),
    },
    quotaUsage: {
      upsert: vi.fn(async () => {
        calls.upsert++;
        return { ai_calls_count: opts.countAfterUpsert };
      }),
      update: vi.fn(async (args) => {
        // args.data is { ai_calls_count: { decrement: 1 } | { increment: 1 } }
        const change = args.data.ai_calls_count;
        if ("decrement" in change) calls.updates.push("decrement");
        else calls.updates.push("increment");
        return {};
      }),
    },
    get __upsertCalls() {
      return calls.upsert;
    },
    get __updateCalls() {
      return calls.updates;
    },
  };
}

describe("reserveQuota", () => {
  it("succeeds when post-increment is under the limit", async () => {
    const db = makeDb({ quotaDaily: 10, countAfterUpsert: 1 });
    await expect(reserveQuota(db, CTX, TODAY)).resolves.toBeUndefined();
    expect(db.__upsertCalls).toBe(1);
    expect(db.__updateCalls).toEqual([]);
  });

  it("succeeds when post-increment equals the limit", async () => {
    // 10 calls allowed; after increment count is 10 — still allowed.
    const db = makeDb({ quotaDaily: 10, countAfterUpsert: 10 });
    await expect(reserveQuota(db, CTX, TODAY)).resolves.toBeUndefined();
    expect(db.__updateCalls).toEqual([]);
  });

  it("throws QuotaExceededError and refunds when over the limit", async () => {
    const db = makeDb({ quotaDaily: 10, countAfterUpsert: 11 });
    await expect(reserveQuota(db, CTX, TODAY)).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
    // The over-limit reservation must be undone.
    expect(db.__updateCalls).toEqual(["decrement"]);
  });

  it("QuotaExceededError reports used/limit accurately", async () => {
    const db = makeDb({ quotaDaily: 10, countAfterUpsert: 11 });
    try {
      await reserveQuota(db, CTX, TODAY);
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      const qe = err as QuotaExceededError;
      // `used` is the count BEFORE this reservation (post - 1).
      expect(qe.used).toBe(10);
      expect(qe.limit).toBe(10);
    }
  });
});

describe("refundQuota", () => {
  it("decrements the counter", async () => {
    const db = makeDb({ quotaDaily: 10, countAfterUpsert: 5 });
    await refundQuota(db, CTX, TODAY);
    expect(db.__updateCalls).toEqual(["decrement"]);
  });

  it("swallows errors so it never masks the original failure", async () => {
    const db: QuotaDb = {
      organization: {
        findUniqueOrThrow: vi.fn(),
      },
      quotaUsage: {
        upsert: vi.fn(),
        update: vi.fn(async () => {
          throw new Error("DB down");
        }),
      },
    };
    await expect(refundQuota(db, CTX, TODAY)).resolves.toBeUndefined();
  });
});

describe("todayUtc", () => {
  it("returns a date at UTC midnight", () => {
    const d = todayUtc();
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });
});
