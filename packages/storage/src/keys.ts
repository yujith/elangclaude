// Object-key construction for tenant-scoped storage.
//
// Per .claude/rules/multi-tenancy.md, storage paths are tenant-scoped just
// like DB rows: "Every key prefixed with org: recordings/{org_id}/{user_id}/
// {attempt_id}.webm". This module is the single place that shape is defined.
//
// It is deliberately PURE — no S3 client, no network — so the tenancy-critical
// logic is unit-tested in isolation. The R2 client in r2.ts calls
// `assertKeyBelongsToOrg` before every signed-URL mint, so a key built for one
// org can never be signed under another ctx.

// cuid IDs are alphanumeric; we also allow `-` and `_` defensively. Anything
// with a path separator, `..`, or whitespace is rejected — no traversal, no
// smuggling a key out of the org prefix.
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function assertIdSafe(label: string, value: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new Error(
      `Unsafe ${label} for storage key: ${JSON.stringify(value)}`,
    );
  }
}

// The file extension to suffix on the R2 key. We accept the two MediaRecorder
// outputs the browser emits: `webm` (Chromium / Firefox / Brave) and `mp4`
// (Safari). The extension is purely a label — R2 doesn't infer content type
// from it — but a sensible suffix helps when a recording is downloaded
// later for inspection.
export type RecordingExtension = "webm" | "mp4";

const ALLOWED_EXTENSIONS: ReadonlySet<RecordingExtension> = new Set([
  "webm",
  "mp4",
]);

export type RecordingKeyParts = {
  org_id: string;
  user_id: string;
  attempt_id: string;
  extension?: RecordingExtension;
};

// recordings/{org_id}/{user_id}/{attempt_id}.{webm|mp4}
export function recordingKey(parts: RecordingKeyParts): string {
  assertIdSafe("org_id", parts.org_id);
  assertIdSafe("user_id", parts.user_id);
  assertIdSafe("attempt_id", parts.attempt_id);
  const extension = parts.extension ?? "webm";
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported recording extension: ${extension}`);
  }
  return `recordings/${parts.org_id}/${parts.user_id}/${parts.attempt_id}.${extension}`;
}

// Maps a recording MIME type to the file extension we store under. Returns
// null when the MIME isn't one of the supported recorder outputs — the
// caller surfaces a friendly error rather than smuggling a bad key in.
export function extensionForMimeType(
  mime: string,
): RecordingExtension | null {
  // Normalize: strip codec parameters and lower-case.
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "audio/webm" || base === "video/webm") return "webm";
  if (base === "audio/mp4" || base === "video/mp4" || base === "audio/m4a") {
    return "mp4";
  }
  return null;
}

// ─── Org branding logo keys (ADR-0023) ──────────────────────────────────
//
// Org logos are tenant data exactly like recordings: org-prefixed key,
// signed URLs only. Raster formats only — SVG is rejected at every layer
// (it can embed script, and these bytes are served back to learners'
// browsers).

export type LogoExtension = "png" | "jpg" | "webp";

const ALLOWED_LOGO_EXTENSIONS: ReadonlySet<LogoExtension> = new Set([
  "png",
  "jpg",
  "webp",
]);

export type BrandingLogoKeyParts = {
  org_id: string;
  extension: LogoExtension;
};

// branding/{org_id}/logo.{png|jpg|webp}
export function brandingLogoKey(parts: BrandingLogoKeyParts): string {
  assertIdSafe("org_id", parts.org_id);
  if (!ALLOWED_LOGO_EXTENSIONS.has(parts.extension)) {
    throw new Error(`Unsupported logo extension: ${parts.extension}`);
  }
  return `branding/${parts.org_id}/logo.${parts.extension}`;
}

// Maps an upload's MIME type to the extension we store under. SVG (and
// anything else) returns null — the caller surfaces a friendly error.
export function logoExtensionForMimeType(mime: string): LogoExtension | null {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "image/png") return "png";
  if (base === "image/jpeg") return "jpg";
  if (base === "image/webp") return "webp";
  return null;
}

// Structural org guard for branding-logo code paths — the logo twin of
// assertKeyBelongsToOrg. Every branding R2 op in r2.ts runs this first.
export function assertBrandingLogoKey(key: string, org_id: string): void {
  assertIdSafe("org_id", org_id);
  const prefix = `branding/${org_id}/`;
  if (!key.startsWith(prefix)) {
    throw new Error(
      `Storage key ${JSON.stringify(key)} is not a branding key for org ${org_id}.`,
    );
  }
  const tail = key.slice(prefix.length);
  const match = /^logo\.([a-z0-9]+)$/.exec(tail);
  if (!match || !ALLOWED_LOGO_EXTENSIONS.has(match[1] as LogoExtension)) {
    throw new Error(
      `Storage key ${JSON.stringify(key)} is not a valid branding logo key.`,
    );
  }
}

// Guards against signing a key from one org under another org's ctx. Every
// signed-URL / download call in r2.ts runs this first.
export function assertKeyBelongsToOrg(key: string, org_id: string): void {
  assertIdSafe("org_id", org_id);
  const prefix = `recordings/${org_id}/`;
  if (!key.startsWith(prefix)) {
    throw new Error(
      `Storage key ${JSON.stringify(key)} is not scoped to org ${org_id}.`,
    );
  }
}

// ─── Global audio keys (Listening TTS cache) ────────────────────────────
//
// Listening audio is shared content, not tenancy data — see ADR 0007 D5.
// One TTS synth per (text, voice_id, model_id) tuple; the resulting bytes
// live under `audio/{sha256}.{ext}` and every learner across every org plays
// the same object. There is NO org_id in the prefix — that is deliberate.
//
// The tenancy guarantee for audio is enforced one layer up: the signed-URL
// minter checks that the requesting ctx owns an Attempt against the parent
// Test before issuing a URL. The object itself is global.
//
// `assertAudioKey` is the structural guard — it prevents a recording key
// (which IS org-scoped) from accidentally being passed into an audio-only
// code path, and vice versa.

export type AudioExtension = "mp3" | "wav" | "ogg";

const ALLOWED_AUDIO_EXTENSIONS: ReadonlySet<AudioExtension> = new Set([
  "mp3",
  "wav",
  "ogg",
]);

// sha256 lowercase hex (64 chars). The hash carries content identity, so we
// reject anything that doesn't look like a hash to avoid bogus, collision-
// prone keys ending up in the bucket.
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type AudioKeyParts = {
  sha256: string;
  extension: AudioExtension;
};

// audio/{sha256}.{ext}
export function audioKey(parts: AudioKeyParts): string {
  if (!SHA256_HEX.test(parts.sha256)) {
    throw new Error(
      `Unsafe sha256 for audio key: ${JSON.stringify(parts.sha256)}`,
    );
  }
  if (!ALLOWED_AUDIO_EXTENSIONS.has(parts.extension)) {
    throw new Error(`Unsupported audio extension: ${parts.extension}`);
  }
  return `audio/${parts.sha256}.${parts.extension}`;
}

// Structural guard for audio-only code paths. A recording key (which is
// `recordings/{org_id}/...`) MUST NOT be passed where an audio key is
// expected, and vice versa — different lifecycles, different ACL stories.
export function assertAudioKey(key: string): void {
  if (!key.startsWith("audio/")) {
    throw new Error(
      `Storage key ${JSON.stringify(key)} is not an audio cache key.`,
    );
  }
  // Validate the rest of the shape to keep callers from constructing
  // their own ad-hoc paths under `audio/`. `audio/{sha256}.{ext}` only.
  const tail = key.slice("audio/".length);
  const dot = tail.lastIndexOf(".");
  if (dot < 0) {
    throw new Error(`Audio key ${JSON.stringify(key)} has no extension.`);
  }
  const sha = tail.slice(0, dot);
  const ext = tail.slice(dot + 1);
  if (!SHA256_HEX.test(sha)) {
    throw new Error(
      `Audio key ${JSON.stringify(key)} does not embed a sha256 hash.`,
    );
  }
  if (!ALLOWED_AUDIO_EXTENSIONS.has(ext as AudioExtension)) {
    throw new Error(
      `Audio key ${JSON.stringify(key)} has an unsupported extension.`,
    );
  }
}

// Maps a TTS provider's response MIME type to the file extension we store
// under. Returns null when the MIME isn't one of the supported audio
// formats — the caller surfaces a friendly error rather than smuggling a
// bad key in.
export function audioExtensionForMimeType(mime: string): AudioExtension | null {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "audio/mpeg" || base === "audio/mp3") return "mp3";
  if (base === "audio/wav" || base === "audio/x-wav") return "wav";
  if (base === "audio/ogg" || base === "application/ogg") return "ogg";
  return null;
}
