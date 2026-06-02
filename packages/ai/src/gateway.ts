// The AI gateway.
//
// Rule, no exceptions: every AI call in the app goes through the gateway.
//   - `ai.chat()`            — text LLM calls (grading, generation)
//   - `ai.realtimeSession()` — mints an ephemeral OpenAI Realtime token
//   - `ai.transcribe()`      — Whisper transcription
//
// The gateway enforces:
//   1. Purpose → allowed-models allowlist for chat (cost discipline)
//   2. Per-user daily quota (atomic reserve + refund-on-failure), weighted —
//      a Realtime session costs more units than one chat call. See ADR 0005.
//   3. Provider routing (anthropic + openrouter for chat; openai for
//      realtime/transcribe).
//
// Tests inject `providers`, `openai`, and `db`. Production callers use the
// default `ai` export which wires the real adapters and `withOrg(ctx)`.

import { withOrg, type OrgContext } from "@elc/db";
import { anthropicProvider, type Provider, type ProviderMessage } from "./adapters/anthropic";
import { openrouterProvider } from "./adapters/openrouter";
import { openaiChatProvider } from "./adapters/openai-chat";
import { openaiAdapter, type OpenAIAdapter } from "./adapters/openai";
import {
  elevenLabsAdapter,
  type ElevenLabsAdapter,
} from "./adapters/elevenlabs";
import type { TranscriptSegment } from "./audio/features";
import { ModelNotAllowedError } from "./errors";
import {
  allowedModelsFor,
  isModelAllowed,
  resolveModel,
  LISTENING_TTS_QUOTA_WEIGHT,
  REALTIME_SESSION_QUOTA_WEIGHT,
  TRANSCRIBE_QUOTA_WEIGHT,
  type ChatPurpose,
  type ProviderName,
} from "./models";
import {
  costFor,
  costForRealtimeSession,
  costForTranscribe,
  costForTts,
} from "./pricing";
import { refundQuota, reserveQuota, type QuotaDb } from "./quota";

export type ChatRequest = {
  ctx: OrgContext;
  purpose: ChatPurpose;
  // Optional override. If omitted, the gateway uses the purpose default.
  // If supplied and not on the purpose allowlist, throws ModelNotAllowedError.
  model?: string;
  messages: ProviderMessage[];
  system?: string;
  maxTokens: number;
};

export type ChatResponse = {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
};

// ── Realtime + transcription request/response shapes ──────────────────────

export type RealtimeSessionRequest = {
  ctx: OrgContext;
  // Examiner-persona instructions for this session. Filled by the caller from
  // the examiner prompt + the chosen Speaking test content.
  instructions?: string;
  // Realtime API voice id; the adapter picks a neutral default when omitted.
  voice?: string;
};

export type RealtimeSessionResponse = {
  // Ephemeral client secret — the browser opens the WebRTC leg with this.
  // The main OPENAI_API_KEY never reaches the client. See ADR 0005 (D2).
  client_secret: string;
  expires_at: number;
  session_id: string;
  model: string;
  // How many quota units this session reserved — surfaced so the caller can
  // show it / log it.
  quota_weight: number;
};

export type TranscribeRequest = {
  ctx: OrgContext;
  audio: Uint8Array;
  filename: string;
  mimeType: string;
  language?: string;
};

export type TranscribeResponse = {
  text: string;
  // Whisper `verbose_json` segments and duration — used to split per IELTS
  // part boundary and to compute audio features.
  segments: TranscriptSegment[];
  duration_sec: number;
};

// ── TTS request/response shapes (Listening, Phase 2) ──────────────────────

export type TtsRequest = {
  ctx: OrgContext;
  text: string;
  voice_id: string;
  // Optional ElevenLabs model override. Defaults to the adapter's pinned
  // ELEVENLABS_DEFAULT_MODEL. If you pass a non-default the TTS cache key
  // changes — every cached clip re-synthesises once.
  model_id?: string;
  // Optional ISO-639-1 language code; the adapter passes it through to
  // ElevenLabs as the model's language hint.
  language_code?: string;
};

export type TtsResponse = {
  audio: Uint8Array;
  mimeType: string;
  model: string;
  // How many quota units this call reserved — surfaced so callers can log
  // it. Constant in v1 (one unit per synth) but kept on the response so
  // future per-call weighting is non-breaking.
  quota_weight: number;
};

export type GatewayDeps = {
  // One Provider per chat ProviderName in the model registry. The gateway
  // routes `ai.chat()` to providers[model.provider]; every registry provider
  // must therefore be wired here.
  providers: Record<ProviderName, Provider>;
  // OpenAI adapter for the non-chat calls (realtime token mint, Whisper).
  openai: OpenAIAdapter;
  // ElevenLabs adapter for Listening TTS synth.
  elevenlabs: ElevenLabsAdapter;
  // Returns a Prisma-shaped client scoped to ctx (typically `withOrg(ctx)`).
  // Injected so tests can pass a mock that doesn't talk to a real DB.
  db: (ctx: OrgContext) => QuotaDb;
};

export function createAI(deps: GatewayDeps) {
  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      // 1. Allowlist check. If the caller passed a model, it must be on
      //    the purpose's allowlist. If they didn't, we use the default —
      //    which is always on the allowlist by construction (see models.ts).
      if (req.model && !isModelAllowed(req.purpose, req.model)) {
        throw new ModelNotAllowedError(
          req.purpose,
          req.model,
          allowedModelsFor(req.purpose),
        );
      }
      const model = resolveModel(req.purpose, req.model);
      if (!isModelAllowed(req.purpose, model.id)) {
        // The purpose has no allowed models (e.g. generation purposes in
        // Phase 1). Better to fail loudly than to silently call a default
        // that no one approved.
        throw new ModelNotAllowedError(
          req.purpose,
          model.id,
          allowedModelsFor(req.purpose),
        );
      }

      const provider = deps.providers[model.provider];
      const db = deps.db(req.ctx);

      // 2. Reserve quota BEFORE calling the provider. If the call fails,
      //    refund. If the call succeeds, the reservation is the accounting.
      await reserveQuota(db, req.ctx);

      try {
        const res = await provider({
          model: model.id,
          messages: req.messages,
          system: req.system,
          maxTokens: req.maxTokens,
        });
        // Record cost AFTER the provider call resolves so failed calls
        // don't accrue spend. Logging failures are swallowed — the AI
        // response must not depend on the cost-log INSERT succeeding.
        await recordAiCall(db, {
          ctx: req.ctx,
          purpose: req.purpose,
          provider: model.provider,
          model: model.id,
          input_tokens: res.usage.input_tokens,
          output_tokens: res.usage.output_tokens,
          cost_usd: costFor(
            model.id,
            res.usage.input_tokens,
            res.usage.output_tokens,
          ),
        });
        return { text: res.text, usage: res.usage, model: model.id };
      } catch (err) {
        await refundQuota(db, req.ctx);
        throw err;
      }
    },

    // Mints an ephemeral OpenAI Realtime token for a Speaking session.
    //
    // Accounting note (ADR 0005, D4): unlike `chat()`, the call and the cost
    // are not the same span — the conversation happens client-side AFTER the
    // mint, and the gateway cannot observe whether the learner connected.
    // v1 reserves on mint and only refunds if the mint itself fails.
    async realtimeSession(
      req: RealtimeSessionRequest,
    ): Promise<RealtimeSessionResponse> {
      const db = deps.db(req.ctx);
      await reserveQuota(db, req.ctx, REALTIME_SESSION_QUOTA_WEIGHT);

      try {
        const session = await deps.openai.mintRealtimeSession({
          instructions: req.instructions,
          voice: req.voice,
        });
        // Realtime cost is a flat per-session estimate — the actual
        // conversation runs client-side and the gateway can't observe
        // duration. Tune the constant in pricing.ts against real billing.
        await recordAiCall(db, {
          ctx: req.ctx,
          purpose: "speaking-realtime",
          provider: "openai",
          model: session.model,
          cost_usd: costForRealtimeSession(),
        });
        return {
          client_secret: session.client_secret,
          expires_at: session.expires_at,
          session_id: session.session_id,
          model: session.model,
          quota_weight: REALTIME_SESSION_QUOTA_WEIGHT,
        };
      } catch (err) {
        await refundQuota(db, req.ctx, REALTIME_SESSION_QUOTA_WEIGHT);
        throw err;
      }
    },

    // Whisper transcription of a finished recording. Reserve-then-refund
    // mirrors `chat()` — the call and the cost are the same span here.
    async transcribe(req: TranscribeRequest): Promise<TranscribeResponse> {
      const db = deps.db(req.ctx);
      await reserveQuota(db, req.ctx, TRANSCRIBE_QUOTA_WEIGHT);

      try {
        const res = await deps.openai.transcribe({
          audio: req.audio,
          filename: req.filename,
          mimeType: req.mimeType,
          language: req.language,
        });
        // Whisper bills per second of audio; the response carries
        // duration_sec via verbose_json, so cost is exact rather than
        // estimated.
        await recordAiCall(db, {
          ctx: req.ctx,
          purpose: "speaking-transcribe",
          provider: "openai",
          model: "whisper-1",
          cost_usd: costForTranscribe(res.duration_sec),
        });
        return {
          text: res.text,
          segments: res.segments,
          duration_sec: res.duration_sec,
        };
      } catch (err) {
        await refundQuota(db, req.ctx, TRANSCRIBE_QUOTA_WEIGHT);
        throw err;
      }
    },

    // ElevenLabs TTS synth for one Listening transcript segment. The call
    // and the cost are the same span (provider returns bytes synchronously),
    // so reserve-then-refund matches the transcribe pattern.
    //
    // Callers are typically the TTS cache layer in
    // `packages/ai/src/listening/tts-cache.ts` — direct route handlers
    // should NOT call `ai.tts()` and bypass the cache.
    async tts(req: TtsRequest): Promise<TtsResponse> {
      const db = deps.db(req.ctx);
      await reserveQuota(db, req.ctx, LISTENING_TTS_QUOTA_WEIGHT);

      try {
        const res = await deps.elevenlabs.synth({
          text: req.text,
          voice_id: req.voice_id,
          model_id: req.model_id,
          language_code: req.language_code,
        });
        // ElevenLabs bills per character of synthesised text. Cache
        // hits in tts-cache.ts shortcut this path entirely, so every
        // log row here is a real synth.
        await recordAiCall(db, {
          ctx: req.ctx,
          purpose: "listening-tts",
          provider: "elevenlabs",
          model: res.model,
          cost_usd: costForTts(req.text.length),
        });
        return {
          audio: res.audio,
          mimeType: res.mimeType,
          model: res.model,
          quota_weight: LISTENING_TTS_QUOTA_WEIGHT,
        };
      } catch (err) {
        await refundQuota(db, req.ctx, LISTENING_TTS_QUOTA_WEIGHT);
        throw err;
      }
    },
  };
}

// Best-effort AiCallLog write. Swallow any error — a logging fault
// never breaks the AI response path. Token counts default to 0 for
// non-chat paths (Realtime / Whisper / TTS aren't token-priced); the
// caller computes cost_usd via the appropriate function in pricing.ts.
async function recordAiCall(
  db: QuotaDb,
  args: {
    ctx: OrgContext;
    purpose: string;
    provider: string;
    model: string;
    input_tokens?: number;
    output_tokens?: number;
    cost_usd: number;
  },
): Promise<void> {
  try {
    await db.aiCallLog.create({
      data: {
        // Explicit even though the production `withOrg(ctx)` proxy
        // would clamp this to ctx.org_id anyway — a future test or
        // misconfiguration that hands in an unwrapped client still
        // writes a correctly-attributed row.
        org_id: args.ctx.org_id,
        user_id: args.ctx.user_id,
        purpose: args.purpose,
        provider: args.provider,
        model: args.model,
        input_tokens: args.input_tokens ?? 0,
        output_tokens: args.output_tokens ?? 0,
        // Pass as string to keep full Decimal precision through Prisma.
        cost_usd: args.cost_usd.toFixed(6),
      },
    });
  } catch (err) {
    console.warn("[ai/gateway] AiCallLog write failed", {
      org_id: args.ctx.org_id,
      user_id: args.ctx.user_id,
      purpose: args.purpose,
      model: args.model,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// Production export. Wires real Anthropic + the org-scoped Prisma client.
// Routes import `ai` and call `ai.chat(...)`.

export const ai = createAI({
  providers: {
    anthropic: anthropicProvider,
    openrouter: openrouterProvider,
    openai: openaiChatProvider,
  },
  openai: openaiAdapter,
  elevenlabs: elevenLabsAdapter,
  db: (ctx) => withOrg(ctx) as unknown as QuotaDb,
});
