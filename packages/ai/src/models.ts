// Purpose → allowed-models registry.
//
// Every gateway call passes a `purpose` (writing-grade, speaking-grade,
// writing-generate, …). The gateway enforces that the requested model is
// on the allowlist for that purpose. This is how we keep the cheap tier
// out of grading and the premium tier out of bulk generation — per the
// AI cost-control rule.
//
// New purposes land here BEFORE any code calls them. Adding a purpose is
// a deliberate cost decision, not an inline default.

// Chat purposes route through the model REGISTRY below — a purpose → allowed
// chat-models allowlist. Every `ai.chat()` call carries one of these.
export type ChatPurpose =
  | "writing-grade"
  | "speaking-grade"
  | "writing-generate"
  | "reading-generate"
  | "listening-generate"
  | "speaking-cue-generate";

// Non-chat AI purposes. These do NOT have a chat-model allowlist — they hit
// fixed provider endpoints (see adapters/openai.ts and adapters/elevenlabs.ts)
// — but they still carry a Purpose so the gateway can quota-gate and cost-
// log them. See ADR 0005 (D1).
export type RealtimePurpose = "speaking-realtime";
export type TranscribePurpose = "speaking-transcribe";
export type TtsPurpose = "listening-tts";

export type Purpose =
  | ChatPurpose
  | RealtimePurpose
  | TranscribePurpose
  | TtsPurpose;

export type ProviderName = "anthropic" | "openrouter" | "openai";

// A Realtime Speaking session is metered as multiple quota units: a ~12-min
// conversation costs roughly an order of magnitude more than a single chat
// call, so counting it as 1 would let the daily quota badly under-price it.
// This weight is deliberately conservative and NOT measured — it is the
// placeholder for BRIEF.md open question #1 ("model a 10-minute
// conversation"). Re-tune against real cost data before Speaking opens past a
// dev org. See ADR 0005 (D3). Transcription stays at 1.
export const REALTIME_SESSION_QUOTA_WEIGHT = 8;
export const TRANSCRIBE_QUOTA_WEIGHT = 1;

// One ListeningPart synthesises into several mp3 clips (one per speech /
// narration segment) — call it ~10 clips per part, ~40 clips per Test.
// Synth happens at SuperAdmin-approval time, not on the learner hot path,
// so this weight is about cost visibility on the cost dashboard rather
// than throttling. Per-call weight stays at 1; the cache layer accumulates
// the count via repeated reserve calls. Revisit if SuperAdmin orgs need a
// distinct quota bucket (planned Phase 2 follow-up).
export const LISTENING_TTS_QUOTA_WEIGHT = 1;

export type ModelEntry = {
  id: string;
  provider: ProviderName;
};

// Anthropic model IDs are the SDK-canonical names. OpenRouter model IDs
// match the slugs OpenRouter publishes; see docs/adr/0004-openrouter-
// reading-generate.md for the choice rationale.

const ANTHROPIC_SONNET: ModelEntry = {
  id: "claude-sonnet-4-5-20250929",
  provider: "anthropic",
};

// OpenAI direct (not via OpenRouter). gpt-4.1-mini is the bulk-generation
// default as of ADR 0020 — chosen for stability and to consolidate onto the
// OPENAI_API_KEY the app already holds for Realtime/Whisper. It follows
// structured-JSON instructions reliably and has headroom for Listening's
// ~12k-token output. Generation does NOT reason about a rubric, so this is
// still a cheap-tier choice relative to Sonnet, which stays grading-only.
const OPENAI_GPT_41_MINI: ModelEntry = {
  id: "gpt-4.1-mini",
  provider: "openai",
};

const OPENROUTER_GEMINI_FLASH: ModelEntry = {
  id: "google/gemini-2.5-flash",
  provider: "openrouter",
};

const OPENROUTER_LLAMA_3_70B: ModelEntry = {
  id: "meta-llama/llama-3.3-70b-instruct",
  provider: "openrouter",
};

const OPENROUTER_MISTRAL_LARGE: ModelEntry = {
  id: "mistralai/mistral-large-2512",
  provider: "openrouter",
};

// OpenRouter free tier. Free models are heavily rate-limited and can be
// deprioritised under load — acceptable for low-volume, SuperAdmin-
// moderated Writing generation. If OpenRouter 404s this slug, the
// gateway surfaces a ProviderError; double-check the id on
// openrouter.ai/models.
const OPENROUTER_NEMOTRON_3_SUPER: ModelEntry = {
  id: "nvidia/nemotron-3-super-120b-a12b:free",
  provider: "openrouter",
};

const REGISTRY: Record<
  ChatPurpose,
  { default: ModelEntry; allowed: ModelEntry[] }
> = {
  "writing-grade": {
    default: ANTHROPIC_SONNET,
    allowed: [ANTHROPIC_SONNET],
  },
  "speaking-grade": {
    default: ANTHROPIC_SONNET,
    allowed: [ANTHROPIC_SONNET],
  },
  // Writing task generation is bulk, SuperAdmin-moderated content. As of
  // ADR 0020 the default is OpenAI gpt-4.1-mini for stability; the previous
  // OpenRouter models stay on the allowlist as fallbacks. Sonnet is
  // deliberately NOT on this allowlist: grading reasons about a rubric,
  // generation does not, and the cost gap is large.
  "writing-generate": {
    default: OPENAI_GPT_41_MINI,
    allowed: [
      OPENAI_GPT_41_MINI,
      OPENROUTER_NEMOTRON_3_SUPER,
      OPENROUTER_GEMINI_FLASH,
      OPENROUTER_MISTRAL_LARGE,
    ],
  },
  // Reading generation: bulk, SuperAdmin-moderated, structured-JSON output.
  // Default migrated to OpenAI gpt-4.1-mini (ADR 0020); OpenRouter models
  // remain on the allowlist as fallbacks.
  "reading-generate": {
    default: OPENAI_GPT_41_MINI,
    allowed: [
      OPENAI_GPT_41_MINI,
      OPENROUTER_GEMINI_FLASH,
      OPENROUTER_LLAMA_3_70B,
      OPENROUTER_MISTRAL_LARGE,
    ],
  },
  // Listening generation is structurally identical to Reading generation
  // (bulk, SuperAdmin-moderated, JSON-output) but the OUTPUT is much
  // larger — a 4-part section with chunked transcripts runs ~10k tokens
  // of JSON. gpt-4.1-mini (ADR 0020 default) has ample output headroom for
  // that; Gemini Flash / Mistral / Llama stay as OpenRouter fallbacks.
  // Sonnet is still deliberately NOT on the allowlist — generation doesn't
  // reason about a rubric, and the cost gap is large.
  "listening-generate": {
    default: OPENAI_GPT_41_MINI,
    allowed: [
      OPENAI_GPT_41_MINI,
      OPENROUTER_GEMINI_FLASH,
      OPENROUTER_MISTRAL_LARGE,
      OPENROUTER_LLAMA_3_70B,
    ],
  },
  // Speaking cue/topic generation is bulk, SuperAdmin-moderated,
  // structured-JSON output — the same profile as reading-generate, so it
  // gets the same model set: gpt-4.1-mini default (ADR 0020) with the
  // OpenRouter cheap tier as fallbacks. Sonnet is deliberately NOT on the
  // allowlist: generation does not reason about a rubric. See ADR 0005 (D5).
  "speaking-cue-generate": {
    default: OPENAI_GPT_41_MINI,
    allowed: [
      OPENAI_GPT_41_MINI,
      OPENROUTER_GEMINI_FLASH,
      OPENROUTER_LLAMA_3_70B,
      OPENROUTER_MISTRAL_LARGE,
    ],
  },
};

export function getDefaultModel(purpose: ChatPurpose): ModelEntry {
  return REGISTRY[purpose].default;
}

export function isModelAllowed(purpose: ChatPurpose, modelId: string): boolean {
  return REGISTRY[purpose].allowed.some((m) => m.id === modelId);
}

export function allowedModelsFor(purpose: ChatPurpose): readonly string[] {
  return REGISTRY[purpose].allowed.map((m) => m.id);
}

export function resolveModel(
  purpose: ChatPurpose,
  modelId?: string,
): ModelEntry {
  if (!modelId) return getDefaultModel(purpose);
  const match = REGISTRY[purpose].allowed.find((m) => m.id === modelId);
  if (!match) {
    // Surface a clean error at the call site instead of silently swapping.
    // The gateway translates this into ModelNotAllowedError.
    return { id: modelId, provider: "anthropic" };
  }
  return match;
}
