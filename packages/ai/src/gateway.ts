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
import { openaiAdapter, type OpenAIAdapter } from "./adapters/openai";
import type { TranscriptSegment } from "./audio/features";
import { ModelNotAllowedError } from "./errors";
import {
  allowedModelsFor,
  isModelAllowed,
  resolveModel,
  REALTIME_SESSION_QUOTA_WEIGHT,
  TRANSCRIBE_QUOTA_WEIGHT,
  type ChatPurpose,
} from "./models";
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

export type GatewayDeps = {
  providers: Record<"anthropic" | "openrouter", Provider>;
  // OpenAI adapter for the non-chat calls (realtime token mint, Whisper).
  openai: OpenAIAdapter;
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
  };
}

// Production export. Wires real Anthropic + the org-scoped Prisma client.
// Routes import `ai` and call `ai.chat(...)`.

export const ai = createAI({
  providers: {
    anthropic: anthropicProvider,
    openrouter: openrouterProvider,
  },
  openai: openaiAdapter,
  db: (ctx) => withOrg(ctx) as unknown as QuotaDb,
});
