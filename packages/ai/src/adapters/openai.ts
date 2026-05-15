// OpenAI adapter. Covers the two non-chat OpenAI calls Speaking needs:
//
//   1. Minting an ephemeral Realtime session token. The browser uses this
//      short-lived token to open the WebRTC voice connection directly to
//      OpenAI — the main OPENAI_API_KEY never reaches the client. See
//      docs/adr/0005-gateway-realtime-and-storage.md (D2).
//   2. Whisper transcription of a finished recording.
//
// Like the OpenRouter adapter, this is plain `fetch` — no SDK. A single
// fetch keeps the dep graph small and the adapter trivially inspectable.
// Failures wrap in ProviderError("openai", ...) so the gateway and callers
// see one error type across providers.

import { ProviderError } from "../errors";
import { requireEnv } from "../env";

const REALTIME_SESSIONS_ENDPOINT = "https://api.openai.com/v1/realtime/sessions";
const TRANSCRIPTIONS_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";

// Pinned model IDs. Realtime + Whisper are NOT on the chat allowlist in
// models.ts — they are not chat purposes — so the IDs live here, next to
// the only code that calls them.
export const OPENAI_REALTIME_MODEL = "gpt-4o-realtime-preview-2024-12-17";
export const OPENAI_TRANSCRIBE_MODEL = "whisper-1";

// Neutral default voice. Phase 5 ("feels human" polish) selects per-test for
// accent variety; until then a single neutral voice is correct.
const DEFAULT_REALTIME_VOICE = "alloy";

export type RealtimeSessionRequest = {
  // System-style instructions shaping the examiner persona for this session.
  // The caller fills this from the examiner prompt + the test content.
  instructions?: string;
  // Realtime API voice id. Defaults to a neutral voice when omitted.
  voice?: string;
};

export type RealtimeSessionResult = {
  // The ephemeral client secret the browser uses to open the WebRTC
  // connection. Short-lived (≈1 min to connect) — not the main API key.
  client_secret: string;
  expires_at: number;
  session_id: string;
  model: string;
};

export type TranscribeRequest = {
  audio: Uint8Array;
  filename: string;
  mimeType: string;
  // Optional ISO-639-1 hint; Whisper auto-detects when omitted.
  language?: string;
};

export type TranscribeResult = {
  text: string;
};

export type OpenAIAdapter = {
  mintRealtimeSession(req: RealtimeSessionRequest): Promise<RealtimeSessionResult>;
  transcribe(req: TranscribeRequest): Promise<TranscribeResult>;
};

async function describeHttpError(res: Response): Promise<string> {
  try {
    return `OpenAI ${res.status}: ${(await res.text()).slice(0, 500)}`;
  } catch {
    return `OpenAI HTTP ${res.status}`;
  }
}

export const openaiAdapter: OpenAIAdapter = {
  async mintRealtimeSession(req) {
    const apiKey = requireEnv("OPENAI_API_KEY");

    let res: Response;
    try {
      res = await fetch(REALTIME_SESSIONS_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_REALTIME_MODEL,
          voice: req.voice ?? DEFAULT_REALTIME_VOICE,
          instructions: req.instructions,
        }),
      });
    } catch (cause) {
      throw new ProviderError("openai", cause);
    }

    if (!res.ok) {
      throw new ProviderError("openai", new Error(await describeHttpError(res)));
    }

    let body: {
      id?: string;
      model?: string;
      expires_at?: number;
      client_secret?: { value?: string; expires_at?: number };
    };
    try {
      body = (await res.json()) as typeof body;
    } catch (cause) {
      throw new ProviderError("openai", cause);
    }

    const secret = body.client_secret?.value;
    if (!secret) {
      throw new ProviderError(
        "openai",
        new Error("Realtime session response had no client_secret."),
      );
    }

    return {
      client_secret: secret,
      expires_at: body.client_secret?.expires_at ?? body.expires_at ?? 0,
      session_id: body.id ?? "",
      model: body.model ?? OPENAI_REALTIME_MODEL,
    };
  },

  async transcribe(req) {
    const apiKey = requireEnv("OPENAI_API_KEY");

    const form = new FormData();
    form.append("model", OPENAI_TRANSCRIBE_MODEL);
    if (req.language) form.append("language", req.language);
    form.append(
      "file",
      // A Uint8Array is a valid BlobPart at runtime; recent TS narrowed the
      // DOM lib's BufferSource to ArrayBufferView<ArrayBuffer>, which a
      // generic Uint8Array<ArrayBufferLike> doesn't satisfy. Cast at the
      // library boundary.
      new Blob([req.audio as BlobPart], { type: req.mimeType }),
      req.filename,
    );

    let res: Response;
    try {
      res = await fetch(TRANSCRIPTIONS_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } catch (cause) {
      throw new ProviderError("openai", cause);
    }

    if (!res.ok) {
      throw new ProviderError("openai", new Error(await describeHttpError(res)));
    }

    let body: { text?: string };
    try {
      body = (await res.json()) as typeof body;
    } catch (cause) {
      throw new ProviderError("openai", cause);
    }

    if (typeof body.text !== "string") {
      throw new ProviderError(
        "openai",
        new Error("Transcription response had no text."),
      );
    }

    return { text: body.text };
  },
};
