// OpenRouter adapter. Implements the Provider shape so the gateway can
// route reading-generate (and any future cheap-tier) calls without
// learning a second SDK.
//
// OpenRouter's API is OpenAI-compatible chat-completions at
// https://openrouter.ai/api/v1/chat/completions. We don't pull in an SDK
// — a single fetch keeps the dep graph small and the adapter trivially
// inspectable.

import { ProviderError } from "../errors";
import { readEnv, requireEnv } from "../env";
import type { Provider, ProviderMessage, ProviderResponse } from "./anthropic";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenRouterResponse = {
  id?: string;
  model?: string;
  choices?: {
    message?: { role?: string; content?: string };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: { message?: string; code?: number | string };
};

function toOpenRouterMessages(
  messages: ProviderMessage[],
  system: string | undefined,
): OpenRouterMessage[] {
  const out: OpenRouterMessage[] = [];
  if (system && system.length > 0) out.push({ role: "system", content: system });
  for (const m of messages) out.push({ role: m.role, content: m.content });
  return out;
}

// Identification headers that OpenRouter recommends (or requires for higher
// rate limits). We don't have a public site URL in v1, so the values
// reflect the local app identity.
function appHeaders(): Record<string, string> {
  return {
    "HTTP-Referer": readEnv("OPENROUTER_APP_URL") ?? "https://elanguage.test",
    "X-Title": readEnv("OPENROUTER_APP_TITLE") ?? "eLanguage Center (dev)",
  };
}

export const openrouterProvider: Provider = async (req) => {
  let apiKey: string;
  try {
    apiKey = requireEnv("OPENROUTER_API_KEY");
  } catch (cause) {
    throw new ProviderError("openrouter", cause);
  }

  let res: Response;
  try {
    res = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...appHeaders(),
      },
      body: JSON.stringify({
        model: req.model,
        messages: toOpenRouterMessages(req.messages, req.system),
        max_tokens: req.maxTokens,
        // Tighter sampling for generation — we want repeatable structure
        // and answers literally in the passage, not creative riffs.
        temperature: 0.4,
      }),
    });
  } catch (cause) {
    throw new ProviderError("openrouter", cause);
  }

  if (!res.ok) {
    let detail: string;
    try {
      detail = await res.text();
    } catch {
      detail = `HTTP ${res.status}`;
    }
    throw new ProviderError(
      "openrouter",
      new Error(`OpenRouter ${res.status}: ${detail.slice(0, 500)}`),
    );
  }

  let body: OpenRouterResponse;
  try {
    body = (await res.json()) as OpenRouterResponse;
  } catch (cause) {
    throw new ProviderError("openrouter", cause);
  }

  if (body.error) {
    throw new ProviderError(
      "openrouter",
      new Error(
        `OpenRouter error: ${body.error.message ?? "unknown"}${
          body.error.code ? ` (code ${body.error.code})` : ""
        }`,
      ),
    );
  }

  const text = body.choices?.[0]?.message?.content ?? "";
  if (text.length === 0) {
    throw new ProviderError(
      "openrouter",
      new Error("OpenRouter returned an empty completion."),
    );
  }

  const result: ProviderResponse = {
    text,
    usage: {
      input_tokens: body.usage?.prompt_tokens ?? 0,
      output_tokens: body.usage?.completion_tokens ?? 0,
    },
  };
  return result;
};
