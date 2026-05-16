// TTS cache layer for Listening audio.
//
// One ListeningContent → many `synth jobs` → many cached audio clips. The
// cache is content-addressed: the storage key embeds the SHA-256 of the
// canonical (text, voice_id, model_id, format, language_code) tuple, so
// the same script line synthesised with the same voice is stored exactly
// once across every Test and every org. Two Tests that happen to use the
// same opening narration line ("Now turn to Part 1.") share one bucket
// object, one R2 PUT, one ElevenLabs invoice line.
//
// The module is split into three layers:
//
//   1. `computeAudioClipKey` — pure: text + voice + model + format → key.
//      No IO. Used by tests and by anyone who needs the key without
//      synthesising (e.g. to GC orphaned clips).
//   2. `planSynthesisJobs` — pure: walks a ListeningContent and returns one
//      synth job per speech / narration segment, with the voice id already
//      resolved via the voice catalogue. No IO.
//   3. `synthesizeAndCache` — IO: hits the AI gateway on cache miss, hits
//      R2 on hit; returns the descriptor either way.
//
// IO operations come in as injected dependencies so the unit tests can run
// without ElevenLabs or R2. The production export wires the real gateway
// and storage; routes import that.

import { createHash } from "node:crypto";
import type { OrgContext } from "@elc/db";
import {
  audioKey as buildAudioKey,
  type AudioExtension,
} from "@elc/storage";
import { ai as defaultAi, type TtsRequest, type TtsResponse } from "../gateway";
import { ELEVENLABS_DEFAULT_MODEL } from "../adapters/elevenlabs";
import type {
  ListeningAudioAsset,
  ListeningAudioFormat,
  ListeningContent,
  ListeningPart,
  ListeningSegment,
  ListeningSpeaker,
} from "./content";
import {
  DEFAULT_VOICE_CATALOGUE,
  pickVoiceForSpeaker,
  type VoiceCatalogue,
} from "./voices";

// ─── Duration estimation ────────────────────────────────────────────────
//
// ElevenLabs' standard /text-to-speech endpoint does not return audio
// duration with the bytes. Computing it from mp3 would require an mp3
// parser dep we don't have, and that level of precision is not load-
// bearing in Phase 2: the only consumers of duration_sec are cost analytics
// and the optional UI "Part 3 — 4 min" badge. The runtime player reads the
// real duration off the `<audio>` element at playback time.
//
// 14 characters per second is the IELTS narration norm (≈150 wpm × ~5.5
// chars/word). We round up so very short lines still register as a sub-
// second clip rather than zero.
const ESTIMATED_CHARS_PER_SECOND = 14;

function estimateDurationSec(text: string): number {
  return Math.max(1, Math.ceil(text.length / ESTIMATED_CHARS_PER_SECOND));
}

// ─── Format mapping ─────────────────────────────────────────────────────

// ListeningAudioFormat names the file extension; ListeningAudioAsset stores
// it. The TTS provider returns a mimeType; we translate. mp3 is the v1
// default — see ELEVENLABS_DEFAULT_MODEL / OUTPUT_FORMAT in the adapter.
function formatFromMime(mime: string): ListeningAudioFormat {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "audio/mpeg" || base === "audio/mp3") return "mp3";
  if (base === "audio/wav" || base === "audio/x-wav") return "wav";
  if (base === "audio/ogg" || base === "application/ogg") return "ogg";
  // Default to mp3 — the adapter requests mp3 explicitly, so anything else
  // suggests a provider misconfiguration we should make loud.
  throw new Error(`Unsupported TTS mime type: ${JSON.stringify(mime)}`);
}

function mimeFromFormat(format: ListeningAudioFormat): string {
  if (format === "mp3") return "audio/mpeg";
  if (format === "wav") return "audio/wav";
  return "audio/ogg";
}

function extensionFromFormat(format: ListeningAudioFormat): AudioExtension {
  // ListeningAudioFormat and AudioExtension are structurally the same; this
  // helper just narrows the type for `buildAudioKey`.
  return format;
}

// ─── Cache key ──────────────────────────────────────────────────────────

export type AudioClipKeyInput = {
  text: string;
  voice_id: string;
  // Pinned to ELEVENLABS_DEFAULT_MODEL when omitted. The cache key depends
  // on the model, so silently swapping it would invalidate every cached
  // clip — that's why the adapter pins a constant.
  model_id?: string;
  format: ListeningAudioFormat;
  // Optional ISO-639-1 language code. Counted into the hash so an "en"
  // synth and a "fr" synth of the same text don't collide.
  language_code?: string;
};

export type AudioClipKey = {
  sha256: string;
  storage_key: string;
  format: ListeningAudioFormat;
};

// Canonical serialization for hashing. Order matters — change the field
// order or add a field and every cached clip becomes a cache miss. New
// fields go at the END, behind an optional check, so cache hits survive.
function canonicalHashInput(input: AudioClipKeyInput): string {
  const model = input.model_id ?? ELEVENLABS_DEFAULT_MODEL;
  // \x1e (record separator) is a delimiter that cannot appear in any of the
  // inputs (text is plain UTF-8 narration, voice/model/format/lang are
  // identifier-shaped). Avoids the classic JSON.stringify-collision risk.
  const parts = [
    `v1`,
    `format=${input.format}`,
    `model=${model}`,
    `voice=${input.voice_id}`,
    `lang=${input.language_code ?? ""}`,
    `text=${input.text}`,
  ];
  return parts.join("\x1e");
}

export function computeAudioClipKey(input: AudioClipKeyInput): AudioClipKey {
  const sha256 = createHash("sha256")
    .update(canonicalHashInput(input))
    .digest("hex");
  const storage_key = buildAudioKey({
    sha256,
    extension: extensionFromFormat(input.format),
  });
  return { sha256, storage_key, format: input.format };
}

// ─── Synthesis planning ─────────────────────────────────────────────────
//
// Walks a ListeningContent and produces one SynthJob per speech / narration
// segment that doesn't already have an `audio_clip` attached. The job
// carries the voice resolution so the orchestrator can call
// `synthesizeAndCache` without re-walking the catalogue.

export type SynthJob = {
  // Stable address into the content so the orchestrator can attach the
  // resulting clip back onto the right segment.
  part_index: number; // 0..3
  segment_index: number; // index into part.transcript
  text: string;
  voice_id: string;
  // For logging / observability — the speaker line this voice came from.
  // Narration segments use a synthetic id "narration" so the picker still
  // distributes them across the catalogue.
  speaker_id: string;
  // Echoed back from the picker. `resolved !== requested` flags an accent
  // fallback worth surfacing in the SuperAdmin preview.
  requested_accent: string;
  resolved_accent: string;
  // The format we'll request from TTS (and the file extension used for the
  // cache key). Constant in v1 (mp3) but kept on the job so a per-Test
  // override is non-breaking.
  format: ListeningAudioFormat;
};

export type PlanSynthesisJobsOptions = {
  // Per-test narration voice override. Real IELTS Listening uses the same
  // narrator across all 4 parts; resolving from the catalogue per segment
  // is correct, but the testId-deterministic hash gives a stable voice for
  // the (testId, "narration") pair, which is exactly the desired behaviour.
  catalogue?: VoiceCatalogue;
  // Output format for every clip. Defaults to mp3.
  format?: ListeningAudioFormat;
};

// Synthetic speaker used for narration segments — gives the picker a
// stable input even though narration has no script-level speaker entry.
function narratorSpeakerForPart(part: ListeningPart): ListeningSpeaker {
  // Prefer the explicit narrator the script defined, falling back to a
  // synthetic british narrator if none is listed. This matches the most
  // common pattern (an explicit narrator speaker in every part).
  const explicit = part.speakers.find((s) => s.role === "narrator");
  if (explicit) return explicit;
  return {
    id: "narrator",
    name: "Narrator",
    role: "narrator",
    accent: "british",
  };
}

export function planSynthesisJobs(
  content: ListeningContent,
  testId: string,
  opts: PlanSynthesisJobsOptions = {},
): SynthJob[] {
  const catalogue = opts.catalogue ?? DEFAULT_VOICE_CATALOGUE;
  const format = opts.format ?? "mp3";
  const jobs: SynthJob[] = [];
  for (let pi = 0; pi < content.parts.length; pi += 1) {
    const part = content.parts[pi];
    if (!part) continue;
    const narrator = narratorSpeakerForPart(part);
    const speakersById = new Map(part.speakers.map((s) => [s.id, s]));
    for (let si = 0; si < part.transcript.length; si += 1) {
      const seg = part.transcript[si]!;
      if (seg.kind === "speech") {
        if (seg.audio_clip) continue;
        const speaker = speakersById.get(seg.speaker_id);
        if (!speaker) continue; // parser guarantees this, but be defensive
        const picked = pickVoiceForSpeaker(speaker, testId, { catalogue });
        jobs.push({
          part_index: pi,
          segment_index: si,
          text: seg.text,
          voice_id: picked.voice_id,
          speaker_id: speaker.id,
          requested_accent: picked.requested,
          resolved_accent: picked.resolved,
          format,
        });
      } else if (seg.kind === "narration") {
        if (seg.audio_clip) continue;
        const picked = pickVoiceForSpeaker(narrator, testId, { catalogue });
        jobs.push({
          part_index: pi,
          segment_index: si,
          text: seg.text,
          voice_id: picked.voice_id,
          speaker_id: narrator.id,
          requested_accent: picked.requested,
          resolved_accent: picked.resolved,
          format,
        });
      }
      // reading-pause + questions-preview = no TTS needed.
    }
  }
  return jobs;
}

// ─── Cache hit/miss + synth + put ───────────────────────────────────────

export type TtsCacheDeps = {
  // The AI gateway's tts call. Default is the production `ai.tts`.
  tts: (req: TtsRequest) => Promise<TtsResponse>;
  // Object existence check + bytes upload, both global (no org_id).
  objectExists: (args: { key: string }) => Promise<boolean>;
  putObject: (args: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
  }) => Promise<void>;
};

export type SynthesizeAndCacheRequest = {
  ctx: OrgContext;
  text: string;
  voice_id: string;
  model_id?: string;
  language_code?: string;
  format?: ListeningAudioFormat;
};

export type SynthesizeAndCacheResult = ListeningAudioAsset & {
  // Whether this call avoided the synth + PUT round-trip. Useful for cost
  // analytics ("we hit cache on 73% of new test synths today").
  cache: "hit" | "miss";
};

export function createTtsCache(deps: TtsCacheDeps) {
  return {
    async synthesizeAndCache(
      req: SynthesizeAndCacheRequest,
    ): Promise<SynthesizeAndCacheResult> {
      const format = req.format ?? "mp3";
      const key = computeAudioClipKey({
        text: req.text,
        voice_id: req.voice_id,
        model_id: req.model_id,
        format,
        language_code: req.language_code,
      });

      // 1. Cache check. HeadObject is cheap (no egress). On hit we skip
      //    both the ElevenLabs call and the R2 PUT — only cost is the
      //    head + the gateway-quota call we DON'T make.
      const exists = await deps.objectExists({ key: key.storage_key });
      if (exists) {
        return {
          storage_key: key.storage_key,
          sha256: key.sha256,
          duration_sec: estimateDurationSec(req.text),
          format,
          cache: "hit",
        };
      }

      // 2. Cache miss → synth. ai.tts() reserves quota, hits ElevenLabs,
      //    refunds on failure. We then PUT the bytes under the content-
      //    addressed key. A double-synth race (two SuperAdmins approve the
      //    same Test simultaneously) is harmless — the second PUT
      //    overwrites with identical bytes.
      const synth = await deps.tts({
        ctx: req.ctx,
        text: req.text,
        voice_id: req.voice_id,
        model_id: req.model_id,
        language_code: req.language_code,
      });

      // Validate the response format matches what the cache key claimed.
      // A mismatch (e.g. mp3 requested but ogg returned) means the cache
      // key is wrong for the bytes — bail loudly rather than upload to a
      // key that no future reader will be able to discover.
      const actualFormat = formatFromMime(synth.mimeType);
      if (actualFormat !== format) {
        throw new Error(
          `TTS returned ${actualFormat} but cache key assumed ${format}. Provider configuration drift.`,
        );
      }

      await deps.putObject({
        key: key.storage_key,
        bytes: synth.audio,
        contentType: mimeFromFormat(format),
      });

      return {
        storage_key: key.storage_key,
        sha256: key.sha256,
        duration_sec: estimateDurationSec(req.text),
        format,
        cache: "miss",
      };
    },
  };
}

// Production export. Wires the real gateway + R2. Routes / orchestrators
// import `ttsCache` and call `ttsCache.synthesizeAndCache(...)`.
//
// The storage import is deferred to runtime via dynamic resolution at the
// call site rather than top-of-file so the bundler doesn't pull
// @elc/storage into edge contexts that never synthesise (the gateway
// import in this file already keeps things server-only, but belt-and-
// braces is cheap).

import {
  audioObjectExists,
  putAudioObject,
} from "@elc/storage";

export const ttsCache = createTtsCache({
  tts: (req) => defaultAi.tts(req),
  objectExists: (args) => audioObjectExists(args),
  putObject: (args) =>
    putAudioObject({
      key: args.key,
      bytes: args.bytes,
      contentType: args.contentType,
    }),
});

// ─── Attaching results back onto a ListeningContent ─────────────────────
//
// After driving synthesizeAndCache over the planSynthesisJobs output, the
// orchestrator (Phase 3 generation pipeline or Phase 5 moderation flow)
// needs to write the resulting clips back into the content's segments.
// This helper does that without mutating the input.

export type SynthesizedClip = {
  part_index: number;
  segment_index: number;
  clip: ListeningAudioAsset;
};

export function attachSynthesizedClips(
  content: ListeningContent,
  clips: readonly SynthesizedClip[],
): ListeningContent {
  // Index clips by (part_index, segment_index) for O(1) lookup.
  const byAddress = new Map<string, ListeningAudioAsset>();
  for (const c of clips) {
    byAddress.set(`${c.part_index}:${c.segment_index}`, c.clip);
  }
  const nextParts: ListeningPart[] = content.parts.map((part, pi) => {
    const nextTranscript: ListeningSegment[] = part.transcript.map(
      (seg, si) => {
        const existing = byAddress.get(`${pi}:${si}`);
        if (!existing) return seg;
        if (seg.kind === "speech") {
          return { ...seg, audio_clip: existing };
        }
        if (seg.kind === "narration") {
          return { ...seg, audio_clip: existing };
        }
        // reading-pause + questions-preview never get clips. Defensive
        // fall-through — the planner shouldn't have addressed them.
        return seg;
      },
    );
    return { ...part, transcript: nextTranscript };
  });
  return { ...content, parts: nextParts };
}
