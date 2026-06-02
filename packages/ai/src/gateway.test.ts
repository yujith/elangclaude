import { describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@elc/db";
import { createAI } from "./gateway";
import { ModelNotAllowedError, ProviderError, QuotaExceededError } from "./errors";
import type { Provider } from "./adapters/anthropic";
import type { OpenAIAdapter } from "./adapters/openai";
import type { ElevenLabsAdapter } from "./adapters/elevenlabs";
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

// A working ElevenLabs adapter with a call counter. Tests that need to
// exercise failure construct the adapter inline.
function fakeElevenLabs(): ElevenLabsAdapter & { synthCalls: number } {
  let synthCalls = 0;
  const adapter: ElevenLabsAdapter = {
    synth: async () => {
      synthCalls++;
      return {
        audio: new Uint8Array([0x49, 0x44, 0x33]), // "ID3" — mp3 marker
        mimeType: "audio/mpeg",
        model: "eleven_multilingual_v2",
      };
    },
  };
  Object.defineProperty(adapter, "synthCalls", { get: () => synthCalls });
  return adapter as ElevenLabsAdapter & { synthCalls: number };
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
    // AiCallLog is best-effort logging — the gateway swallows errors,
    // so a no-op mock keeps these tests focused on quota/allowlist behaviour.
    aiCallLog: {
      create: vi.fn(async () => ({})),
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
        openai: vi.fn() as unknown as Provider,
      },
      openai: fakeOpenAI(),
      elevenlabs: fakeElevenLabs(),
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
        openai: vi.fn() as unknown as Provider,
      },
      openai: fakeOpenAI(),
      elevenlabs: fakeElevenLabs(),
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

  it("rejects a non-allowlisted model on the listening-generate purpose", async () => {
    // listening-generate is on the cheap OpenRouter set (Phase 3) — passing
    // a Sonnet override is a programming error and must throw.
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
        openai: vi.fn() as unknown as Provider,
      },
      openai: fakeOpenAI(),
      elevenlabs: fakeElevenLabs(),
      db: fakeDb({ quotaDaily: 10, countAfterUpsert: 1 }),
    });
    await expect(
      ai.chat({
        ctx: CTX,
        purpose: "listening-generate",
        model: "claude-sonnet-4-5-20250929",
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
        openai: vi.fn() as unknown as Provider,
      },
      openai: fakeOpenAI(),
      elevenlabs: fakeElevenLabs(),
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
      aiCallLog: { create: vi.fn(async () => ({})) },
    });
    const ai = createAI({
      providers: {
        anthropic: async () => {
          throw new Error("upstream 500");
        },
        openrouter: vi.fn() as unknown as Provider,
        openai: vi.fn() as unknown as Provider,
      },
      openai: fakeOpenAI(),
      elevenlabs: fakeElevenLabs(),
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
        openai: vi.fn() as unknown as Provider,
      },
      openai,
      elevenlabs: fakeElevenLabs(),
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
        openai: vi.fn() as unknown as Provider,
      },
      openai,
      elevenlabs: fakeElevenLabs(),
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
      aiCallLog: { create: vi.fn(async () => ({})) },
    });
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
        openai: vi.fn() as unknown as Provider,
      },
      openai: {
        mintRealtimeSession: async () => {
          throw new ProviderError("openai", new Error("realtime 500"));
        },
        transcribe: async () => ({ text: "", segments: [], duration_sec: 0 }),
      },
      elevenlabs: fakeElevenLabs(),
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
        openai: vi.fn() as unknown as Provider,
      },
      openai,
      elevenlabs: fakeElevenLabs(),
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
        openai: vi.fn() as unknown as Provider,
      },
      openai,
      elevenlabs: fakeElevenLabs(),
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
      aiCallLog: { create: vi.fn(async () => ({})) },
    });
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
        openai: vi.fn() as unknown as Provider,
      },
      openai: {
        mintRealtimeSession: async () => {
          throw new Error("unused");
        },
        transcribe: async () => {
          throw new ProviderError("openai", new Error("whisper 500"));
        },
      },
      elevenlabs: fakeElevenLabs(),
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

describe("gateway: tts (Listening)", () => {
  it("synthesises audio when under quota", async () => {
    const elevenlabs = fakeElevenLabs();
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
        openai: vi.fn() as unknown as Provider,
      },
      openai: fakeOpenAI(),
      elevenlabs,
      db: fakeDb({ quotaDaily: 10, countAfterUpsert: 1 }),
    });
    const res = await ai.tts({
      ctx: CTX,
      text: "Welcome to Riverside Library.",
      voice_id: "voice_test_1",
    });
    expect(res.audio.byteLength).toBeGreaterThan(0);
    expect(res.mimeType).toBe("audio/mpeg");
    expect(res.quota_weight).toBe(1);
    expect(elevenlabs.synthCalls).toBe(1);
  });

  it("does not call ElevenLabs when quota is exhausted", async () => {
    const elevenlabs = fakeElevenLabs();
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
        openai: vi.fn() as unknown as Provider,
      },
      openai: fakeOpenAI(),
      elevenlabs,
      db: fakeDb({ quotaDaily: 10, countAfterUpsert: 11 }),
    });
    await expect(
      ai.tts({ ctx: CTX, text: "hello", voice_id: "voice_test_1" }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(elevenlabs.synthCalls).toBe(0);
  });

  it("refunds the reservation if synth throws", async () => {
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
      aiCallLog: { create: vi.fn(async () => ({})) },
    });
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
        openai: vi.fn() as unknown as Provider,
      },
      openai: fakeOpenAI(),
      elevenlabs: {
        synth: async () => {
          throw new ProviderError("elevenlabs", new Error("tts 500"));
        },
      },
      db,
    });
    await expect(
      ai.tts({ ctx: CTX, text: "hello", voice_id: "voice_test_1" }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(updates).toEqual(["decrement"]);
  });
});

// AiCallLog.create is the money primitive — make sure each gateway path
// writes exactly one row on success with the right shape, and zero rows
// on failure. The chat path covers token-based pricing; realtime/whisper/
// tts each have their own cost basis (flat / duration / characters).

type AiCallLogCapture = {
  user_id: string | null;
  purpose: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | string;
};

function fakeDbCapturing(opts: {
  quotaDaily: number;
  countAfterUpsert: number;
}): {
  db: (ctx: OrgContext) => QuotaDb;
  captured: AiCallLogCapture[];
} {
  const captured: AiCallLogCapture[] = [];
  return {
    captured,
    db: () => ({
      organization: {
        findUniqueOrThrow: vi.fn(async () => ({ quota_daily: opts.quotaDaily })),
      },
      quotaUsage: {
        upsert: vi.fn(async () => ({ ai_calls_count: opts.countAfterUpsert })),
        update: vi.fn(async () => ({})),
      },
      aiCallLog: {
        create: vi.fn(async (args) => {
          captured.push(args.data);
          return {};
        }),
      },
    }),
  };
}

describe("gateway: AiCallLog cost capture", () => {
  it("chat writes one row with token-based cost on success", async () => {
    const { db, captured } = fakeDbCapturing({
      quotaDaily: 100,
      countAfterUpsert: 1,
    });
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
        openai: vi.fn() as unknown as Provider,
      },
      openai: fakeOpenAI(),
      elevenlabs: fakeElevenLabs(),
      db,
    });
    await ai.chat({
      ctx: CTX,
      purpose: "writing-grade",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      purpose: "writing-grade",
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      input_tokens: 100,
      output_tokens: 50,
    });
    // 100 input * $3/M + 50 output * $15/M = $0.0003 + $0.00075 = $0.00105
    expect(Number(captured[0]!.cost_usd)).toBeCloseTo(0.00105, 6);
  });

  it("realtime writes one row with a flat-session cost on success", async () => {
    const { db, captured } = fakeDbCapturing({
      quotaDaily: 100,
      countAfterUpsert: 8,
    });
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
        openai: vi.fn() as unknown as Provider,
      },
      openai: fakeOpenAI(),
      elevenlabs: fakeElevenLabs(),
      db,
    });
    await ai.realtimeSession({ ctx: CTX });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      purpose: "speaking-realtime",
      provider: "openai",
      model: "gpt-4o-realtime-preview-2024-12-17",
      input_tokens: 0,
      output_tokens: 0,
    });
    // Flat estimate $0.30 / session — see pricing.ts.
    expect(Number(captured[0]!.cost_usd)).toBeCloseTo(0.3, 6);
  });

  it("transcribe writes one row with duration-based cost on success", async () => {
    const { db, captured } = fakeDbCapturing({
      quotaDaily: 100,
      countAfterUpsert: 1,
    });
    const openai: OpenAIAdapter = {
      mintRealtimeSession: async () => {
        throw new Error("not used here");
      },
      transcribe: async () => ({
        text: "hi",
        segments: [],
        // 12-minute audio = 720s.
        duration_sec: 720,
      }),
    };
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
        openai: vi.fn() as unknown as Provider,
      },
      openai,
      elevenlabs: fakeElevenLabs(),
      db,
    });
    await ai.transcribe({
      ctx: CTX,
      audio: new Uint8Array([]),
      filename: "x.webm",
      mimeType: "audio/webm",
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      purpose: "speaking-transcribe",
      provider: "openai",
      model: "whisper-1",
    });
    // 720 sec * $0.0001/sec = $0.072 (12 min at $0.006/min).
    expect(Number(captured[0]!.cost_usd)).toBeCloseTo(0.072, 6);
  });

  it("tts writes one row with character-based cost on success", async () => {
    const { db, captured } = fakeDbCapturing({
      quotaDaily: 100,
      countAfterUpsert: 1,
    });
    const ai = createAI({
      providers: {
        anthropic: fakeProvider(),
        openrouter: vi.fn() as unknown as Provider,
        openai: vi.fn() as unknown as Provider,
      },
      openai: fakeOpenAI(),
      elevenlabs: fakeElevenLabs(),
      db,
    });
    const text = "a".repeat(1000); // exactly 1k chars
    await ai.tts({ ctx: CTX, text, voice_id: "v_test" });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      purpose: "listening-tts",
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
    });
    // 1000 chars * $0.18/1k = $0.18.
    expect(Number(captured[0]!.cost_usd)).toBeCloseTo(0.18, 6);
  });

  it("does NOT write a row when the provider call fails", async () => {
    const { db, captured } = fakeDbCapturing({
      quotaDaily: 100,
      countAfterUpsert: 1,
    });
    const ai = createAI({
      providers: {
        anthropic: async () => {
          throw new Error("upstream 500");
        },
        openrouter: vi.fn() as unknown as Provider,
        openai: vi.fn() as unknown as Provider,
      },
      openai: fakeOpenAI(),
      elevenlabs: fakeElevenLabs(),
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
    expect(captured).toHaveLength(0);
  });
});
