# ADR 0005 — Gateway realtime + transcription extension, and the `@elc/storage` package

Status: Accepted
Date: 2026-05-15

## Context

Phase 0 of the Speaking feature plan needs three things written down before
code lands, because they extend two hard rules in `.claude/rules/`:

1. **`ai-cost-control.md` says every AI call goes through `packages/ai/src/gateway.ts`.**
   The gateway as built is `ai.chat()` — a text request/response. Speaking
   needs two calls that are not chat: minting an **OpenAI Realtime** session
   (a WebRTC voice conversation) and **Whisper** transcription of the finished
   recording. Forcing those through `chat()` would be a lie; leaving them
   outside the gateway would break the cost rule.
2. **The quota model counts calls, not cost.** `QuotaUsage.ai_calls_count` is
   an integer. A ~12-minute Realtime conversation costs roughly an order of
   magnitude more than a single grading call. Counting it as `1` would let the
   daily quota badly under-price Speaking.
3. **`architecture.md` locks object storage to Cloudflare R2, but no R2 code
   exists yet.** Speaking recordings are the first consumer. Storage paths must
   be tenant-scoped per `multi-tenancy.md`.

## Decisions

### D1 — The gateway grows two new methods, not a `chat()` overload

`createAI()` returns `chat()` today. Phase 0 adds:

- `ai.realtimeSession({ ctx, instructions?, voice? })` — reserves quota, mints
  a short-lived **ephemeral** OpenAI Realtime client token, returns it.
- `ai.transcribe({ ctx, audio, filename, mimeType, language? })` — reserves
  quota, runs Whisper on the bytes, returns the transcript.

They are separate methods because their inputs and outputs have nothing in
common with chat. To keep the type system honest, `Purpose` is split:

```ts
type ChatPurpose = "writing-grade" | "speaking-grade" | "writing-generate"
                 | "reading-generate" | "listening-generate" | "speaking-cue-generate";
type RealtimePurpose  = "speaking-realtime";
type TranscribePurpose = "speaking-transcribe";
type Purpose = ChatPurpose | RealtimePurpose | TranscribePurpose;
```

The chat model **`REGISTRY`** in `models.ts` stays `Record<ChatPurpose, …>` —
the realtime/transcribe purposes do not have a chat-model allowlist because
they hit fixed OpenAI endpoints. Their model IDs are pinned in
`adapters/openai.ts` next to the only code that calls them. `ai.chat()` cannot
be called with a non-chat purpose: the type won't allow it.

### D2 — Ephemeral tokens: the browser does the WebRTC leg directly

The Realtime API supports minting a short-lived client token server-side. The
browser uses that token to open the WebRTC connection directly to OpenAI. The
main `OPENAI_API_KEY` **never reaches the client**. The server action that
calls `ai.realtimeSession()` runs under `requireOrgContext()`, so the token is
always minted for an authenticated, quota-checked user.

### D3 — A Realtime session is metered as a weighted quota unit

Rather than migrate `QuotaUsage` to track cost (a schema change we are not
ready to design), a Realtime session **reserves `REALTIME_SESSION_QUOTA_WEIGHT`
units** against the same `ai_calls_count` counter. Transcription reserves `1`.

`reserveQuota` / `refundQuota` gain a `weight` parameter (default `1`, so every
existing `chat()` callsite is unchanged).

The initial weight is **`8`** — deliberately conservative, not measured. This
is the placeholder for **`BRIEF.md` open question #1** ("model a 10-minute
conversation"). The number lives as a single exported constant in `models.ts`
and should be re-tuned against real cost data before Speaking opens past a dev
org. Picking a weight now keeps the quota counter meaningful; refusing to pick
one would block the whole phase on a measurement we cannot take until Phase 2.

Consequence of weighting on one integer counter: the `QuotaExceededError`
message reports `used` units, which for a learner who has done one Speaking
session will read `8/N` rather than `1/N`. Acceptable for v1 — the number is
honest (units consumed), just coarser than "sessions."

### D4 — Reserve-on-mint accounting for Realtime

`chat()` reserves quota, calls the provider, and refunds if the provider
throws — the call and the accounting are the same span. A Realtime session is
different: the gateway mints a token, then the **conversation happens
client-side afterward**. The gateway cannot observe whether the learner
actually connected.

v1 accounting: **reserve on mint, refund only if minting itself fails.** If a
learner mints a token and never connects, they have still "spent" a session.
This is the pragmatic choice — a token mint is a strong intent signal, and a
webhook/usage-reconciliation pass is a Phase 5+ refinement, not a Phase 0
blocker. Documented here so the tradeoff is not rediscovered as a bug.

### D5 — `speaking-cue-generate` activates on the cheap tier

The purpose's allowlist was empty (`allowed: []`). Phase 1 needs it. Speaking
content generation is bulk, SuperAdmin-moderated, structured-JSON output — the
same profile as `reading-generate`. It gets the same OpenRouter model set:
Gemini 2.5 Flash (default), Llama 3.3 70B, Mistral Large (fallbacks). Sonnet is
deliberately **not** on the allowlist — generation does not reason about a
rubric (per `ai-cost-control.md`).

### D6 — A new `@elc/storage` workspace package owns R2

R2 access is needed by **two** packages: `apps/web` server actions (mint signed
upload/download URLs) and, later, server-side download for the transcription +
audio-feature pass. It does not belong in `@elc/ai` (it is not AI) or `@elc/db`
(it is not the database). It gets its own package, mirroring the `@elc/db`
scaffold (`package.json`, `tsconfig.json`, `vitest.config.ts`, thin
`src/index.ts`).

R2 speaks the S3 API, so the package uses `@aws-sdk/client-s3` +
`@aws-sdk/s3-request-presigner` pointed at the R2 endpoint. Structure:

- `keys.ts` — **pure** object-key construction. Recording keys are
  `recordings/{org_id}/{user_id}/{attempt_id}.webm`. This is the
  tenancy-critical bit, so it is pure and unit-tested without the network.
  `assertKeyBelongsToOrg()` is called before every signed-URL mint so a key
  from one org cannot be signed under another `ctx`.
- `r2.ts` — the S3 client + `signedUploadUrl`, `signedDownloadUrl`,
  `downloadObject`. Signed URLs only, 15-minute default expiry — raw object
  keys never reach the client (`architecture.md`).
- `env.ts` — the same lazy `packages/db/.env` loader pattern as
  `packages/ai/src/env.ts`, so the package builds and tests green without R2
  credentials present.

## Consequences

- `packages/ai/src/adapters/openai.ts` lands — plain `fetch`, no SDK, mirroring
  the OpenRouter adapter. Failures wrap in `ProviderError("openai", …)`.
- `packages/ai/src/models.ts` splits `Purpose`, activates `speaking-cue-generate`,
  and exports `REALTIME_SESSION_QUOTA_WEIGHT` / `TRANSCRIBE_QUOTA_WEIGHT`.
- `packages/ai/src/quota.ts` gains the `weight` parameter.
- `packages/ai/src/gateway.ts` gains `realtimeSession()` + `transcribe()` and a
  required `openai` dep on `GatewayDeps`.
- `packages/storage/` is a new workspace package; `tsconfig.base.json` gets the
  `@elc/storage` path alias.
- New runtime env vars: `OPENAI_API_KEY` (already in `packages/db/.env`),
  `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`,
  `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET`. All four R2 vars
  must be provided before Phase 3 can be tested end-to-end; Phase 0/1 code
  builds and unit-tests without them.

## Alternatives considered

- **Force realtime + transcription through `chat()`.** Rejected — the shapes do
  not fit, and overloading `chat()` to carry audio would make the one
  most-used gateway method the hardest to read.
- **Migrate `QuotaUsage` to track `cost_usd` now.** Rejected for Phase 0 — it is
  a real schema + accounting redesign (atomic cost reservation, provider price
  tables) and should not block the Speaking build. Weighted call units are a
  smaller, reversible step.
- **Put R2 in `apps/web/lib/storage`.** Rejected — the transcription pass in
  `packages/ai` needs server-side download, and `apps/web` cannot be a
  dependency of `packages/ai`.
- **Hand-roll AWS SigV4 for R2 signing.** Rejected — signing is exactly the
  kind of security-sensitive code we should not hand-roll. The AWS SDK is the
  boring correct choice.
