// Anthropic adapter. Wraps the SDK so the gateway depends on a small,
// stable shape (Provider) and can be unit-tested without touching the
// network or the SDK class.

import Anthropic from "@anthropic-ai/sdk";
import { ProviderError } from "../errors";
import { requireEnv } from "../env";

export type ProviderMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export type ProviderRequest = {
  model: string;
  messages: ProviderMessage[];
  system?: string;
  maxTokens: number;
};

export type ProviderUsage = {
  input_tokens: number;
  output_tokens: number;
};

export type ProviderResponse = {
  text: string;
  usage: ProviderUsage;
};

export type Provider = (req: ProviderRequest) => Promise<ProviderResponse>;

let clientSingleton: Anthropic | undefined;

function getClient(): Anthropic {
  if (clientSingleton) return clientSingleton;
  clientSingleton = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  return clientSingleton;
}

export const anthropicProvider: Provider = async (req) => {
  try {
    const res = await getClient().messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const text = res.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    return {
      text,
      usage: {
        input_tokens: res.usage.input_tokens,
        output_tokens: res.usage.output_tokens,
      },
    };
  } catch (cause) {
    throw new ProviderError("anthropic", cause);
  }
};
