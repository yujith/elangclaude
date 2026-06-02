# ADR 0020 — OpenAI as the default content-generation provider

- Status: Accepted
- Date: 2026-06-02
- Supersedes the generation-provider defaults in ADR 0004 (Reading) and the
  OpenRouter cheap-tier choices recorded in `.claude/rules/ai-cost-control.md`.

## Context

All four content-generation surfaces (`/content/{reading,listening,writing,speaking}`)
were failing in production with `generate_error=unknown`. Investigation
(Vercel runtime logs + code analysis) found the root cause was **not** the LLM
provider at all: the repo-root `prompts/` markdown directory was absent from
the deployed serverless function. The prompt loaders
(`packages/ai/src/{generation,grading}/prompts.ts`) read the markdown at
runtime via a computed `readFileSync` path that Next's static file tracer
cannot follow, so `readFileSync` threw `ENOENT` for
`/var/task/prompts/generation/*.md`. An OpenRouter fault would have surfaced as
`generate_error=provider` (every OpenRouter failure path is wrapped in
`ProviderError`); the `unknown` code is the catch-all for an otherwise-untyped
throw — here, the `ENOENT`.

Separately, the team wants to consolidate bulk generation onto OpenAI for
stability and to reuse the `OPENAI_API_KEY` the app already holds for the
Realtime examiner and Whisper transcription, rather than depend on OpenRouter's
free/cheap tiers (rate-limited, occasionally deprioritised).

## Decision

Two independent changes, shipped in order:

1. **Fix prompt delivery (provider-agnostic).** `apps/web/next.config.ts` sets
   `outputFileTracingRoot` to the monorepo root and
   `outputFileTracingIncludes` to bundle `../../prompts/**/*.md` into every
   route's function. Verified: the four generation prompts and five grading
   prompts now appear in each `(super)/content/**` `*.nft.json`, resolving to
   the real repo-root files, which deploy to `/var/task/prompts/...` — the
   exact path the loaders request. This also repairs the identical latent
   bug in the grading prompt loader.

2. **Make OpenAI `gpt-4.1-mini` the default for the four generation purposes.**
   A new `adapters/openai-chat.ts` implements the `Provider` shape against
   `https://api.openai.com/v1/chat/completions` (plain `fetch`, no SDK,
   `ProviderError("openai", …)` on every failure). The model registry
   (`models.ts`) routes `reading-generate`, `listening-generate`,
   `writing-generate`, and `speaking-cue-generate` to `gpt-4.1-mini` by
   default; the previous OpenRouter models (Gemini Flash, Mistral Large,
   Llama 3.3, Nemotron) remain on each allowlist as fallbacks. Grading stays
   on Claude Sonnet — generation does not reason about a rubric, so the
   cheap-tier-vs-Sonnet split from ADR 0004/0005 is preserved.

## Consequences

- **Good.** Generation works again. Single primary vendor for generation +
  realtime + transcription. OpenRouter remains a one-line-revert fallback (its
  models are still allowed; flip the registry `default` back if needed).
- **Cost.** A small increase over the free OpenRouter tier — roughly a fraction
  of a cent (Reading) up to ~1–2¢ (Listening) per successful generation, ×
  retries (max 3). Trivial at SuperAdmin-moderated, pool-cached volume. The
  `gpt-4.1-mini` row was added to `pricing.ts` so the cost dashboard attributes
  it (provider `openai`) instead of logging it as an unknown model.
- **Env.** No new variable — reuses `OPENAI_API_KEY` (already required for
  Speaking Realtime + Whisper). The key must be present wherever generation
  runs.
- **Bad / watch.** `outputFileTracingIncludes` is a build-time tracing
  mechanism; if a future Next/Turbopack upgrade changes tracing behaviour, the
  prompt files could silently fall out of the bundle again. A
  load-each-prompt smoke test guards against the regression. Verify
  `gpt-4.1-mini`'s output cap comfortably covers Listening's 12k-token target
  against real generations.
