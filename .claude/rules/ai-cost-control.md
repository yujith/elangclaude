# AI Cost Control Rules

> Auto-loaded with every Claude Code session.

## The one rule

**Every LLM, TTS, STT, or realtime AI call goes through `packages/ai/src/gateway.ts`.** No exceptions. The gateway enforces quotas, logs token usage, and attributes cost per `org_id`.

## Why this matters

A single misbehaving feature can run up four-figure bills overnight. A leaked API key can do five. Enterprise orgs buy per-seat with a quota — if we let any caller bypass the quota gate, we're shipping an unpriced product.

## The gateway contract

```ts
import { ai } from "@/ai/gateway";

const result = await ai.chat({
  ctx,                                    // includes org_id, user_id
  purpose: "writing-grade",               // tagged for cost dashboards
  model: "claude-sonnet-4-7",             // gateway routes/falls-back as needed
  messages: [...],
  maxTokens: 1500,
});
```

The gateway:
1. Reads `ctx.user_id`'s `QuotaUsage` for today.
2. Compares against the org's `quota_daily`.
3. If at limit → throws `QuotaExceededError` (the route catches and returns a friendly 429).
4. If under limit → makes the call, increments the counter atomically, logs token usage with `{ org_id, user_id, purpose, input_tokens, output_tokens, cost_usd }`.

## Model selection cheat sheet

| Purpose | Model | Why |
|---|---|---|
| Reading/Listening question generation | OpenAI `gpt-4.1-mini` (OpenRouter Gemini Flash / Mistral / Llama as fallback) | Stable, bulk, SuperAdmin-moderated — ADR-0020 |
| Writing prompt generation | OpenAI `gpt-4.1-mini` (OpenRouter Nemotron / Gemini Flash / Mistral as fallback) | Stable; OpenRouter free tier was rate-limited — ADR-0020 |
| Speaking cue/topic generation | OpenAI `gpt-4.1-mini` (OpenRouter cheap tier as fallback) | Same profile as Reading — ADR-0020 |
| TTS for Listening audio | ElevenLabs (variety of accents) | Cache aggressively |
| Writing grading | Claude Sonnet | Rubric reasoning matters |
| Speaking grading (transcript pass) | Claude Sonnet | Rubric reasoning matters |
| Automated content review (`content-review`) | Claude Sonnet | Replaces the human moderation gate (ADR-0024); cross-vendor check on the gpt-4.1-mini generator. The ONE sanctioned Sonnet purpose outside grading — schedule-bound volume, never learner-triggered |
| Speaking transcription | Whisper | Standard |
| Speaking realtime conversation | OpenAI Realtime API | Lowest viable latency |

Never call the premium tier (Sonnet) for bulk generation. Never call the cheap tier for grading. The gateway enforces this with a `purpose → allowed-models` allowlist (`packages/ai/src/models.ts`). The four generation purposes default to OpenAI `gpt-4.1-mini`; OpenRouter models stay on the allowlist so a re-roll can fall back via an explicit `model` override.

Background automation (ADR-0024) is the answered case of "calling an LLM from a background job": runs execute under `SYSTEM_ORG_ID` with a dedicated `quota_daily` (2000) through the NORMAL gateway gate — never add a quota-bypass path for automation.

## Caching strategy

- **Generated tests**: AI generates only when the existing pool is exhausted *for that user*. New tests enter the global pool, are SuperAdmin-approved before learners see them, then reused across all users/orgs.
- **TTS audio**: hash of `(text, voice, accent)` → R2 key. Never re-synthesize the same audio.
- **Grading**: do not cache. Each attempt gets fresh grading.

## When to ask the human

- Adding a new AI provider → ask first. The gateway needs adapting and cost dashboards updating.
- Removing the quota gate "temporarily for testing" → no. Use a dev org with a high quota instead.
- Calling an LLM from a long-running background job → ask. Background quotas are tracked separately.
