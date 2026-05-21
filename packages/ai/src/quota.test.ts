import { describe, expect, it, vi } from "vitest";
import { QuotaExceededError } from "./errors";
import { refundQuota, reserveQuota, todayUtc, type QuotaDb } from "./quota";

const CTX = { org_id: "org_1", user_id: "user_1", role: "Learner" as const };
const TODAY = todayUtc();

type UpdateDelta = { dir: "increment" | "decrement"; amount: number };

function makeDb(opts: {
  quotaDaily: number;
  countAfterUpsert: number;
}): QuotaDb & {
  __upsertCalls: number;
  __updateCalls: Array<"increment" | "decrement">;
  __updateDeltas: UpdateDelta[];
} {
  const calls = {
    upsert: 0,
    updates: [] as Array<"increment" | "decrement">,
    deltas: [] as UpdateDelta[],
  };
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
        const change = args.data.ai_calls_count;
        if ("decrement" in change) {
          calls.updates.push("decrement");
          calls.deltas.push({ dir: "decrement", amount: change.decrement });
        } else {
          calls.updates.push("increment");
          calls.deltas.push({ dir: "increment", amount: change.increment });
        }
        return {};
      }),
    },
    aiCallLog: { create: vi.fn(async () => ({})) },
    get __upsertCalls() {
      return calls.upsert;
    },
    get __updateCalls() {
      return calls.updates;
    },
    get __updateDeltas() {
      return calls.deltas;
    },
  };
}

describe("reserveQuota", () => {
  it("succeeds when post-increment is under the limit", async () => {
    const db = makeDb({ quotaDaily: 10, countAfterUpsert: 1 });
    await expect(reserveQuota(db, CTX, 1, TODAY)).resolves.toBeUndefined();
    expect(db.__upsertCalls).toBe(1);
    expect(db.__updateCalls).toEqual([]);
  });

  it("succeeds when post-increment equals the limit", async () => {
    // 10 calls allowed; after increment count is 10 — still allowed.
    const db = makeDb({ quotaDaily: 10, countAfterUpsert: 10 });
    await expect(reserveQuota(db, CTX, 1, TODAY)).resolves.toBeUndefined();
    expect(db.__updateCalls).toEqual([]);
  });

  it("throws QuotaExceededError and refunds when over the limit", async () => {
    const db = makeDb({ quotaDaily: 10, countAfterUpsert: 11 });
    await expect(reserveQuota(db, CTX, 1, TODAY)).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
    // The over-limit reservation must be undone.
    expect(db.__updateCalls).toEqual(["decrement"]);
  });

  it("QuotaExceededError reports used/limit accurately", async () => {
    const db = makeDb({ quotaDaily: 10, countAfterUpsert: 11 });
    try {
      await reserveQuota(db, CTX, 1, TODAY);
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      const qe = err as QuotaExceededError;
      // `used` is the count BEFORE this reservation (post - weight).
      expect(qe.used).toBe(10);
      expect(qe.limit).toBe(10);
    }
  });

  it("defaults weight to 1 when omitted", async () => {
    const db = makeDb({ quotaDaily: 10, countAfterUpsert: 5 });
    await expect(reserveQuota(db, CTX)).resolves.toBeUndefined();
    expect(db.__upsertCalls).toBe(1);
  });
});

describe("reserveQuota — weighted (Realtime sessions)", () => {
  it("reserves the full weight and succeeds when under the limit", async () => {
    // A weight-8 session, post-upsert count 8, limit 100 — fine.
    const db = makeDb({ quotaDaily: 100, countAfterUpsert: 8 });
    await expect(reserveQuota(db, CTX, 8, TODAY)).resolves.toBeUndefined();
    expect(db.__updateCalls).toEqual([]);
  });

  it("refunds the FULL weight when the weighted reservation is over the limit", async () => {
    // Post-upsert count 11, limit 10 — over. The refund must decrement by the
    // same weight that was reserved, not by 1.
    const db = makeDb({ quotaDaily: 10, countAfterUpsert: 11 });
    await expect(reserveQuota(db, CTX, 8, TODAY)).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
    expect(db.__updateDeltas).toEqual([{ dir: "decrement", amount: 8 }]);
  });

  it("reports `used` as post-count minus the full weight", async () => {
    const db = makeDb({ quotaDaily: 10, countAfterUpsert: 11 });
    try {
      await reserveQuota(db, CTX, 8, TODAY);
      expect.fail("expected throw");
    } catch (err) {
      const qe = err as QuotaExceededError;
      expect(qe.used).toBe(3); // 11 - 8
      expect(qe.limit).toBe(10);
    }
  });
});

describe("refundQuota", () => {
  it("decrements the counter by 1 by default", async () => {
    const db = makeDb({ quotaDaily: 10, countAfterUpsert: 5 });
    await refundQuota(db, CTX, 1, TODAY);
    expect(db.__updateDeltas).toEqual([{ dir: "decrement", amount: 1 }]);
  });

  it("decrements by the given weight", async () => {
    const db = makeDb({ quotaDaily: 100, countAfterUpsert: 5 });
    await refundQuota(db, CTX, 8, TODAY);
    expect(db.__updateDeltas).toEqual([{ dir: "decrement", amount: 8 }]);
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
      aiCallLog: { create: vi.fn(async () => ({})) },
    };
    await expect(refundQuota(db, CTX, 1, TODAY)).resolves.toBeUndefined();
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
