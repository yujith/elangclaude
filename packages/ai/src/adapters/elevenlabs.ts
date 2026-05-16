// ElevenLabs TTS adapter. The single non-chat ElevenLabs call we need: turn
// a paragraph of script text into mp3 bytes for the Listening section's
// per-part audio asset.
//
// Like the OpenAI and OpenRouter adapters, this is plain `fetch` — no SDK.
// One fetch keeps the dep graph small and the adapter trivially inspectable.
// Failures wrap in ProviderError("elevenlabs", ...) so the gateway and
// callers see one error type across providers.
//
// Required env var: ELEVENLABS_API_KEY. The shared local secret store is
// packages/db/.env (see packages/ai/src/env.ts). Add it there before
// running the SuperAdmin approval flow that triggers synth.

import { ProviderError } from "../errors";
import { requireEnv } from "../env";

// Pinned default model. eleven_multilingual_v2 is the broadly-available,
// accent-credible model — narrator-quality without paying for the Pro-tier
// timestamps endpoint. If you change this, audit voice catalog entries to
// make sure each voice is still supported on the new model.
export const ELEVENLABS_DEFAULT_MODEL = "eleven_multilingual_v2";

// We always request 44.1 kHz / 128 kbps mp3. R2 storage cost is negligible
// at the part-level (≈3-5 MB per Listening part), and 128 kbps is the
// crossover point where ABX listening tests stop telling mp3 from source on
// speech content.
const OUTPUT_FORMAT = "mp3_44100_128";

const TTS_ENDPOINT_BASE = "https://api.elevenlabs.io/v1/text-to-speech";

export type ElevenLabsSynthRequest = {
  text: string;
  voice_id: string;
  // Optional override; defaults to ELEVENLABS_DEFAULT_MODEL.
  model_id?: string;
  // Optional ISO-639-1 language code passed to the model. Most voices auto-
  // detect; setting "en" on a Listening synth nudges accent-stable output
  // when the script contains a stray non-English proper noun.
  language_code?: string;
  // Optional override of the mp3 output profile. Keep the default unless
  // you know what you're doing — the cache key is computed over inputs, so
  // a non-default format silently re-synthesises every learner's audio.
  output_format?: string;
};

export type ElevenLabsSynthResult = {
  audio: Uint8Array;
  mimeType: string;
  // The model that actually answered. Echoed back so the cache can log
  // which model produced these bytes; we don't depend on the provider to
  // honour the request 1:1 (rate-limit fallbacks, deprecations).
  model: string;
};

export type ElevenLabsAdapter = {
  synth(req: ElevenLabsSynthRequest): Promise<ElevenLabsSynthResult>;
};

async function describeHttpError(res: Response): Promise<string> {
  try {
    return `ElevenLabs ${res.status}: ${(await res.text()).slice(0, 500)}`;
  } catch {
    return `ElevenLabs HTTP ${res.status}`;
  }
}

export const elevenLabsAdapter: ElevenLabsAdapter = {
  async synth(req) {
    if (req.text.length === 0) {
      // Defensive — an empty-text TTS call wastes a quota slot and burns a
      // bucket key (sha256 of "" is a stable, real hash) for no audio.
      throw new ProviderError(
        "elevenlabs",
        new Error("synth() called with empty text"),
      );
    }
    if (req.voice_id.length === 0) {
      throw new ProviderError(
        "elevenlabs",
        new Error("synth() called with empty voice_id"),
      );
    }

    const apiKey = requireEnv("ELEVENLABS_API_KEY");
    const model_id = req.model_id ?? ELEVENLABS_DEFAULT_MODEL;
    const output_format = req.output_format ?? OUTPUT_FORMAT;

    // Output format is a query param on the v1 endpoint, not a body field.
    const url = `${TTS_ENDPOINT_BASE}/${encodeURIComponent(req.voice_id)}?output_format=${encodeURIComponent(output_format)}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          // The endpoint returns audio bytes; explicit Accept makes the
          // provider behaviour stable across content-negotiation changes.
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: req.text,
          model_id,
          language_code: req.language_code,
        }),
      });
    } catch (cause) {
      throw new ProviderError("elevenlabs", cause);
    }

    if (!res.ok) {
      throw new ProviderError(
        "elevenlabs",
        new Error(await describeHttpError(res)),
      );
    }

    // The body is raw audio bytes — read as ArrayBuffer then narrow to
    // Uint8Array so downstream `Blob` / `crypto.subtle.digest` calls take
    // a familiar shape.
    let audio: Uint8Array;
    try {
      audio = new Uint8Array(await res.arrayBuffer());
    } catch (cause) {
      throw new ProviderError("elevenlabs", cause);
    }
    if (audio.byteLength === 0) {
      throw new ProviderError(
        "elevenlabs",
        new Error("synth() returned an empty audio body"),
      );
    }

    // The endpoint's default response is audio/mpeg even when we asked for
    // pcm or wav via output_format — so honour the actual response header.
    const mimeType =
      res.headers.get("content-type")?.split(";")[0]?.trim() || "audio/mpeg";

    return { audio, mimeType, model: model_id };
  },
};
