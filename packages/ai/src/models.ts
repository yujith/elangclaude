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

export type ProviderName = "anthropic" | "openrouter";

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

const OPENROUTER_GEMINI_FLASH: ModelEntry = {
  id: "google/gemini-2.0-flash-001",
  provider: "openrouter",
};

const OPENROUTER_LLAMA_3_70B: ModelEntry = {
  id: "meta-llama/llama-3.3-70b-instruct",
  provider: "openrouter",
};

const OPENROUTER_MISTRAL_LARGE: ModelEntry = {
  id: "mistralai/mistral-large-2411",
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
  // Writing task generation is bulk, SuperAdmin-moderated content — it
  // runs on the cheap OpenRouter tier per ai-cost-control.md. Sonnet is
  // deliberately NOT on this allowlist: grading reasons about a rubric,
  // generation does not, and the cost gap is large. Default is the free
  // Nemotron tier; Gemini Flash and Mistral Large stay on the allowlist
  // as paid fallbacks if the free tier is rate-limited.
  "writing-generate": {
    default: OPENROUTER_NEMOTRON_3_SUPER,
    allowed: [
      OPENROUTER_NEMOTRON_3_SUPER,
      OPENROUTER_GEMINI_FLASH,
      OPENROUTER_MISTRAL_LARGE,
    ],
  },
  // Generation purposes that are not yet activated keep `allowed: []` so a
  // stray caller gets a clear "model not allowed" error rather than a
  // silent default. They wake up when their phase lands.
  "reading-generate": {
    default: OPENROUTER_GEMINI_FLASH,
    allowed: [
      OPENROUTER_GEMINI_FLASH,
      OPENROUTER_LLAMA_3_70B,
      OPENROUTER_MISTRAL_LARGE,
    ],
  },
  // Listening generation is structurally identical to Reading generation:
  // bulk, SuperAdmin-moderated, JSON-output. Same cheap OpenRouter set
  // applies. Sonnet is deliberately NOT on this allowlist — generation
  // doesn't reason about a rubric, and the cost gap is large.
  "listening-generate": {
    default: OPENROUTER_GEMINI_FLASH,
    allowed: [
      OPENROUTER_GEMINI_FLASH,
      OPENROUTER_LLAMA_3_70B,
      OPENROUTER_MISTRAL_LARGE,
    ],
  },
  // Speaking cue/topic generation is bulk, SuperAdmin-moderated,
  // structured-JSON output — the same profile as reading-generate, so it
  // gets the same cheap OpenRouter model set. Sonnet is deliberately NOT on
  // the allowlist: generation does not reason about a rubric. See ADR 0005 (D5).
  "speaking-cue-generate": {
    default: OPENROUTER_GEMINI_FLASH,
    allowed: [
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
