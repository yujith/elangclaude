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

// Anthropic model IDs are the SDK-canonical names. When we add OpenRouter
// adapters in Phase 5 those entries land here with provider "openrouter".

const ANTHROPIC_SONNET: ModelEntry = {
  id: "claude-sonnet-4-5-20250929",
  provider: "anthropic",
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
  // Generation purposes are wired in Phase 5 alongside the OpenRouter
  // adapter. Listed here so the type union compiles and a stray caller
  // gets a clear "model not allowed" error rather than a silent default.
  "writing-generate": { default: ANTHROPIC_SONNET, allowed: [] },
  "reading-generate": { default: ANTHROPIC_SONNET, allowed: [] },
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
