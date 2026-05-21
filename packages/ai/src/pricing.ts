// Per-model pricing for AiCallLog.
//
// Values are USD per million tokens, sourced from each provider's public
// pricing page in May 2026. These are approximations — the figures on
// invoices include API discounts, batch tiers, and cache hits that this
// table cannot know about. Treat the dashboard column as a budgeting
// indicator, not a billing record. Tune against real invoices.
//
// Unknown models log with cost = 0 and a single console.warn so an
// untracked model surfaces in the logs without breaking the AI path.

export type ModelPricing = {
  // USD per 1,000,000 input tokens.
  input_per_million_usd: number;
  // USD per 1,000,000 output tokens.
  output_per_million_usd: number;
};

const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "claude-sonnet-4-5-20250929": {
    input_per_million_usd: 3,
    output_per_million_usd: 15,
  },
  // OpenRouter — frequently-routed paid models.
  "google/gemini-2.0-flash-001": {
    input_per_million_usd: 0.075,
    output_per_million_usd: 0.3,
  },
  "meta-llama/llama-3.3-70b-instruct": {
    input_per_million_usd: 0.59,
    output_per_million_usd: 0.79,
  },
  "mistralai/mistral-large-2411": {
    input_per_million_usd: 2,
    output_per_million_usd: 6,
  },
  // OpenRouter free tier — explicit zero so the dashboard shows
  // free-tier traffic without falling into the "unknown model" warn path.
  "nvidia/nemotron-3-super-120b-a12b:free": {
    input_per_million_usd: 0,
    output_per_million_usd: 0,
  },
};

const warnedModels = new Set<string>();

export function pricingFor(model: string): ModelPricing | null {
  return PRICING[model] ?? null;
}

export function costFor(
  model: string,
  input_tokens: number,
  output_tokens: number,
): number {
  const pricing = pricingFor(model);
  if (!pricing) {
    if (!warnedModels.has(model)) {
      warnedModels.add(model);
      console.warn(
        `[ai/pricing] no entry for model "${model}" — logging cost as 0. ` +
          `Add it to packages/ai/src/pricing.ts to fix the spend dashboard.`,
      );
    }
    return 0;
  }
  const input_cost =
    (input_tokens / 1_000_000) * pricing.input_per_million_usd;
  const output_cost =
    (output_tokens / 1_000_000) * pricing.output_per_million_usd;
  // 6 dp matches AiCallLog.cost_usd Decimal(10,6).
  return Math.round((input_cost + output_cost) * 1_000_000) / 1_000_000;
}

// Test-only: clear the dedupe set so a vitest run can assert that an
// unknown model logs its warning once.
export function _resetPricingWarnsForTest(): void {
  warnedModels.clear();
}

// ─── Non-chat paths ────────────────────────────────────────────────────────
//
// Realtime / Whisper / ElevenLabs don't price by tokens, so they live
// outside the PRICING table. Each function below returns USD for one
// gateway call; the gateway uses it to populate AiCallLog.cost_usd.
// Tune against real invoices — these are public-list ballpark figures.

// Realtime sessions are minted server-side, but the conversation that
// drives cost happens client-side over WebRTC. The gateway cannot
// observe duration or token usage, so v1 logs a flat estimate per
// session. Tune against the first month of real billing. See ADR 0005
// D3/D4 (the "model a 10-minute conversation" open question from BRIEF
// #1 lives here).
const REALTIME_SESSION_FLAT_USD = 0.3;

export function costForRealtimeSession(): number {
  return REALTIME_SESSION_FLAT_USD;
}

// Whisper API: $0.006 / minute of audio = $0.0001 / second.
// `verbose_json` gives us `duration_sec` so the cost is exact, not estimated.
const WHISPER_USD_PER_SECOND = 0.0001;

export function costForTranscribe(duration_sec: number): number {
  if (!Number.isFinite(duration_sec) || duration_sec <= 0) return 0;
  const cost = duration_sec * WHISPER_USD_PER_SECOND;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

// ElevenLabs Pro tier list price is ~$0.18 / 1k characters.
// Different tiers and the Flash model price differently — this is the
// number worth tuning first from a real invoice.
const ELEVENLABS_USD_PER_1K_CHARS = 0.18;

export function costForTts(character_count: number): number {
  if (!Number.isFinite(character_count) || character_count <= 0) return 0;
  const cost = (character_count / 1000) * ELEVENLABS_USD_PER_1K_CHARS;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
