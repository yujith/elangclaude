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

export type Purpose =
  | "writing-grade"
  | "speaking-grade"
  | "writing-generate"
  | "reading-generate"
  | "listening-generate"
  | "speaking-cue-generate";

export type ProviderName = "anthropic" | "openrouter";

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

const REGISTRY: Record<Purpose, { default: ModelEntry; allowed: ModelEntry[] }> = {
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
  "listening-generate": { default: ANTHROPIC_SONNET, allowed: [] },
  "speaking-cue-generate": { default: ANTHROPIC_SONNET, allowed: [] },
};

export function getDefaultModel(purpose: Purpose): ModelEntry {
  return REGISTRY[purpose].default;
}

export function isModelAllowed(purpose: Purpose, modelId: string): boolean {
  return REGISTRY[purpose].allowed.some((m) => m.id === modelId);
}

export function allowedModelsFor(purpose: Purpose): readonly string[] {
  return REGISTRY[purpose].allowed.map((m) => m.id);
}

export function resolveModel(purpose: Purpose, modelId?: string): ModelEntry {
  if (!modelId) return getDefaultModel(purpose);
  const match = REGISTRY[purpose].allowed.find((m) => m.id === modelId);
  if (!match) {
    // Surface a clean error at the call site instead of silently swapping.
    // The gateway translates this into ModelNotAllowedError.
    return { id: modelId, provider: "anthropic" };
  }
  return match;
}
