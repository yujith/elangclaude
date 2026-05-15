import { describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@elc/db";
import { createAI } from "./gateway";
import { ModelNotAllowedError, ProviderError, QuotaExceededError } from "./errors";
import type { Provider } from "./adapters/anthropic";
import type { OpenAIAdapter } from "./adapters/openai";
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

// A working OpenAI adapter with call counters. Failure cases construct an
// adapter inline rather than parameterising this helper.
function fakeOpenAI(): OpenAIAdapter & {
  realtimeCalls: number;
  transcribeCalls: number;
} {
  let realtimeCalls = 0;
  let transcribeCalls = 0;
  const adapter: OpenAIAdapter = {
    mintRealtimeSession: async () => {
      realtimeCalls++;
      return {
        client_secret: "ek_test_secret",
        expires_at: 1_900_000_000,
        session_id: "sess_test",
        model: "gpt-4o-realtime-preview-2024-12-17",
      };
    },
    transcribe: async () => {
      transcribeCalls++;
      return { text: "transcribed text", segments: [], duration_sec: 0 };
    },
  };
  Object.defineProperty(adapter, "realtimeCalls", { get: () => realtimeCalls });
  Object.defineProperty(adapter, "transcribeCalls", {
    get: () => transcribeCalls,
  });
  return adapter as OpenAIAdapter & {
    realtimeCalls: number;
    transcribeCalls: number;
  };
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
      openai: fakeOpenAI(),
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
      openai: fakeOpenAI(),
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
    // listening-generate still has an empty allowlist — it wakes up when
    // the Listening section lands.
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
      },
      openai: fakeOpenAI(),
      db: fakeDb({ quotaDaily: 10, countAfterUpsert: 1 }),
    });
    await expect(
      ai.chat({
        ctx: CTX,
        purpose: "listening-generate",
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
      openai: fakeOpenAI(),
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
      openai: fakeOpenAI(),
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

describe("gateway: realtimeSession", () => {
  it("mints an ephemeral token when under quota", async () => {
    const openai = fakeOpenAI();
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
      },
      openai,
      db: fakeDb({ quotaDaily: 100, countAfterUpsert: 8 }),
    });
    const res = await ai.realtimeSession({
      ctx: CTX,
      instructions: "You are an IELTS examiner.",
    });
    expect(res.client_secret).toBe("ek_test_secret");
    expect(res.quota_weight).toBe(8);
    expect(openai.realtimeCalls).toBe(1);
  });

  it("does not mint a token when quota is exhausted", async () => {
    const openai = fakeOpenAI();
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
      },
      openai,
      // Post-upsert count of 11 with limit 10 → over.
      db: fakeDb({ quotaDaily: 10, countAfterUpsert: 11 }),
    });
    await expect(
      ai.realtimeSession({ ctx: CTX }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(openai.realtimeCalls).toBe(0);
  });

  it("refunds the weighted reservation if minting fails", async () => {
    const updates: Array<"increment" | "decrement"> = [];
    const db: (ctx: OrgContext) => QuotaDb = () => ({
      organization: {
        findUniqueOrThrow: vi.fn(async () => ({ quota_daily: 100 })),
      },
      quotaUsage: {
        upsert: vi.fn(async () => ({ ai_calls_count: 8 })),
        update: vi.fn(async (args) => {
          const change = args.data.ai_calls_count;
          updates.push("decrement" in change ? "decrement" : "increment");
          return {};
        }),
      },
    });
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
      },
      openai: {
        mintRealtimeSession: async () => {
          throw new ProviderError("openai", new Error("realtime 500"));
        },
        transcribe: async () => ({ text: "", segments: [], duration_sec: 0 }),
      },
      db,
    });
    await expect(ai.realtimeSession({ ctx: CTX })).rejects.toBeInstanceOf(
      ProviderError,
    );
    // The weighted reservation must be undone exactly once.
    expect(updates).toEqual(["decrement"]);
  });
});

describe("gateway: transcribe", () => {
  it("transcribes audio when under quota", async () => {
    const openai = fakeOpenAI();
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
      },
      openai,
      db: fakeDb({ quotaDaily: 10, countAfterUpsert: 1 }),
    });
    const res = await ai.transcribe({
      ctx: CTX,
      audio: new Uint8Array([1, 2, 3]),
      filename: "rec.webm",
      mimeType: "audio/webm",
    });
    expect(res.text).toBe("transcribed text");
    expect(openai.transcribeCalls).toBe(1);
  });

  it("does not call Whisper when quota is exhausted", async () => {
    const openai = fakeOpenAI();
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
      },
      openai,
      db: fakeDb({ quotaDaily: 10, countAfterUpsert: 11 }),
    });
    await expect(
      ai.transcribe({
        ctx: CTX,
        audio: new Uint8Array([1, 2, 3]),
        filename: "rec.webm",
        mimeType: "audio/webm",
      }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(openai.transcribeCalls).toBe(0);
  });

  it("refunds the reservation if Whisper throws", async () => {
    const updates: Array<"increment" | "decrement"> = [];
    const db: (ctx: OrgContext) => QuotaDb = () => ({
      organization: {
        findUniqueOrThrow: vi.fn(async () => ({ quota_daily: 10 })),
      },
      quotaUsage: {
        upsert: vi.fn(async () => ({ ai_calls_count: 1 })),
        update: vi.fn(async (args) => {
          const change = args.data.ai_calls_count;
          updates.push("decrement" in change ? "decrement" : "increment");
          return {};
        }),
      },
    });
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
      },
      openai: {
        mintRealtimeSession: async () => {
          throw new Error("unused");
        },
        transcribe: async () => {
          throw new ProviderError("openai", new Error("whisper 500"));
        },
      },
      db,
    });
    await expect(
      ai.transcribe({
        ctx: CTX,
        audio: new Uint8Array([1, 2, 3]),
        filename: "rec.webm",
        mimeType: "audio/webm",
      }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(updates).toEqual(["decrement"]);
  });
});
