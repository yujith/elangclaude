import { describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@elc/db";
import { createAI } from "./gateway";
import { ModelNotAllowedError, QuotaExceededError } from "./errors";
import type { Provider } from "./adapters/anthropic";
import type { QuotaDb } from "./quota";

const CTX: OrgContext = {
  org_id: "org_1",
  user_id: "user_1",
  role: "Learner",
};

function fakeProvider(text = "OK"): Provider & { calls: number } {
  let calls = 0;
  const fn: Provider = async () => {
    calls++;
    return { text, usage: { input_tokens: 100, output_tokens: 50 } };
  };
  Object.defineProperty(fn, "calls", { get: () => calls });
  return fn as Provider & { calls: number };
}

function fakeDb(opts: {
  quotaDaily: number;
  countAfterUpsert: number;
}): (ctx: OrgContext) => QuotaDb {
  return () => ({
    organization: {
      findUniqueOrThrow: vi.fn(async () => ({ quota_daily: opts.quotaDaily })),
    },
    quotaUsage: {
      upsert: vi.fn(async () => ({ ai_calls_count: opts.countAfterUpsert })),
      update: vi.fn(async () => ({})),
    },
  });
}

describe("gateway: allowlist", () => {
  it("uses the default model when none specified for an allowed purpose", async () => {
    const provider = fakeProvider();
    const ai = createAI({
      providers: {
        anthropic: provider,
        openrouter: vi.fn() as unknown as Provider,
      },
      db: fakeDb({ quotaDaily: 10, countAfterUpsert: 1 }),
    });
    const res = await ai.chat({
      ctx: CTX,
      purpose: "writing-grade",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
    });
    expect(res.model).toBe("claude-sonnet-4-5-20250929");
    expect(provider.calls).toBe(1);
  });

  it("rejects a non-allowlisted model override", async () => {
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
      },
      db: fakeDb({ quotaDaily: 10, countAfterUpsert: 1 }),
    });
    await expect(
      ai.chat({
        ctx: CTX,
        purpose: "writing-grade",
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 100,
      }),
    ).rejects.toBeInstanceOf(ModelNotAllowedError);
  });

  it("rejects any model on a purpose with no allowed models", async () => {
    // writing-generate has an empty allowlist in Phase 1.
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
      },
      db: fakeDb({ quotaDaily: 10, countAfterUpsert: 1 }),
    });
    await expect(
      ai.chat({
        ctx: CTX,
        purpose: "writing-generate",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 100,
      }),
    ).rejects.toBeInstanceOf(ModelNotAllowedError);
  });
});

describe("gateway: quota integration", () => {
  it("does not call the provider when quota is exhausted", async () => {
    const provider = fakeProvider();
    const ai = createAI({
      providers: {
        anthropic: provider,
        openrouter: vi.fn() as unknown as Provider,
      },
      // Post-upsert count of 11 with limit 10 → over.
      db: fakeDb({ quotaDaily: 10, countAfterUpsert: 11 }),
    });
    await expect(
      ai.chat({
        ctx: CTX,
        purpose: "writing-grade",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 100,
      }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(provider.calls).toBe(0);
  });

  it("refunds the reservation if the provider throws", async () => {
    const updates: string[] = [];
    const db: (ctx: OrgContext) => QuotaDb = () => ({
      organization: {
        findUniqueOrThrow: vi.fn(async () => ({ quota_daily: 10 })),
      },
      quotaUsage: {
        upsert: vi.fn(async () => ({ ai_calls_count: 1 })),
        update: vi.fn(async (args) => {
          const change = args.data.ai_calls_count;
          if ("decrement" in change) updates.push("decrement");
          return {};
        }),
      },
    });
    const ai = createAI({
      providers: {
        anthropic: async () => {
          throw new Error("upstream 500");
        },
        openrouter: vi.fn() as unknown as Provider,
      },
      db,
    });
    await expect(
      ai.chat({
        ctx: CTX,
        purpose: "writing-grade",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 100,
      }),
    ).rejects.toThrow("upstream 500");
    expect(updates).toEqual(["decrement"]);
  });
});
