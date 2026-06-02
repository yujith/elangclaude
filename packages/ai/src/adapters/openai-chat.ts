// OpenAI chat-completions adapter. Implements the Provider shape so the
// gateway can route the four generation purposes (reading/listening/writing/
// speaking-cue) to OpenAI directly — the bulk-generation default as of
// ADR 0020 (migrated off OpenRouter for stability).
//
// Like the OpenRouter and OpenAI-Realtime adapters, this is plain `fetch` —
// no SDK. A single fetch keeps the dep graph small and the adapter trivially
// inspectable. Failures wrap in ProviderError("openai", ...) so the gateway
// and callers see one error type across providers; the cost dashboard
// attributes these rows to provider "openai", same as Realtime/Whisper.
//
// NOTE: this is distinct from `adapters/openai.ts` (Realtime token mint +
// Whisper). That one hits fixed non-chat endpoints; this one is a chat
// Provider in the model registry.

import { ProviderError } from "../errors";
import { requireEnv } from "../env";
import type { Provider, ProviderMessage, ProviderResponse } from "./anthropic";

const OPENAI_CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions";

type OpenAIChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenAIChatResponse = {
  id?: string;
  model?: string;
  choices?: {
    message?: { role?: string; content?: string };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: { message?: string; code?: number | string; type?: string };
};

function toOpenAIMessages(
  messages: ProviderMessage[],
  system: string | undefined,
): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  if (system && system.length > 0) out.push({ role: "system", content: system });
  for (const m of messages) out.push({ role: m.role, content: m.content });
  return out;
}

export const openaiChatProvider: Provider = async (req) => {
  let apiKey: string;
  try {
    apiKey = requireEnv("OPENAI_API_KEY");
  } catch (cause) {
    throw new ProviderError("openai", cause);
  }

  let res: Response;
  try {
    res = await fetch(OPENAI_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: req.model,
        messages: toOpenAIMessages(req.messages, req.system),
        max_tokens: req.maxTokens,
        // Tighter sampling for generation — we want repeatable structure
        // and answers grounded in the passage, not creative riffs. Matches
        // the OpenRouter adapter so a fallback re-roll behaves the same.
        temperature: 0.4,
      }),
    });
  } catch (cause) {
    throw new ProviderError("openai", cause);
  }

  if (!res.ok) {
    let detail: string;
    try {
      detail = await res.text();
    } catch {
      detail = `HTTP ${res.status}`;
    }
    throw new ProviderError(
      "openai",
      new Error(`OpenAI ${res.status}: ${detail.slice(0, 500)}`),
    );
  }

  let body: OpenAIChatResponse;
  try {
    body = (await res.json()) as OpenAIChatResponse;
  } catch (cause) {
    throw new ProviderError("openai", cause);
  }

  if (body.error) {
    throw new ProviderError(
      "openai",
      new Error(
        `OpenAI error: ${body.error.message ?? "unknown"}${
          body.error.code ? ` (code ${body.error.code})` : ""
        }`,
      ),
    );
  }

  const text = body.choices?.[0]?.message?.content ?? "";
  if (text.length === 0) {
    throw new ProviderError(
      "openai",
      new Error("OpenAI returned an empty completion."),
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
