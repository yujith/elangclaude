import { afterEach, describe, expect, it, vi } from "vitest";
import { openaiChatProvider } from "./openai-chat";
import { ProviderError } from "../errors";

// The adapter reads OPENAI_API_KEY via requireEnv and calls fetch. Both are
// stubbed so the test never touches the network or the real key.

function stubFetch(impl: (url: string, init: RequestInit) => Response) {
  const fn = vi.fn(async (url: unknown, init: unknown) =>
    impl(String(url), (init ?? {}) as RequestInit),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("openaiChatProvider", () => {
  it("sends a system+user message, max_tokens and temperature, and maps usage", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-123");
    const fetchFn = stubFetch(() =>
      okResponse({
        model: "gpt-4.1-mini",
        choices: [{ message: { role: "assistant", content: "{\"ok\":true}" } }],
        usage: { prompt_tokens: 321, completion_tokens: 654 },
      }),
    );

    const res = await openaiChatProvider({
      model: "gpt-4.1-mini",
      system: "You are a generator.",
      messages: [{ role: "user", content: "Generate one unit." }],
      maxTokens: 6000,
    });

    expect(res.text).toBe('{"ok":true}');
    expect(res.usage).toEqual({ input_tokens: 321, output_tokens: 654 });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.max_tokens).toBe(6000);
    expect(body.temperature).toBe(0.4);
    expect(body.messages).toEqual([
      { role: "system", content: "You are a generator." },
      { role: "user", content: "Generate one unit." },
    ]);
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer sk-test-123",
    });
  });

  it("wraps a non-2xx response in ProviderError", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-123");
    stubFetch(
      () =>
        new Response("rate limited", { status: 429, statusText: "Too Many" }),
    );
    await expect(
      openaiChatProvider({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: "x" }],
        maxTokens: 100,
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("wraps an empty completion in ProviderError", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-123");
    stubFetch(() =>
      okResponse({ choices: [{ message: { role: "assistant", content: "" } }] }),
    );
    await expect(
      openaiChatProvider({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: "x" }],
        maxTokens: 100,
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("wraps a missing API key in ProviderError", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(
      openaiChatProvider({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: "x" }],
        maxTokens: 100,
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
