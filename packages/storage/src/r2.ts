// Cloudflare R2 client.
//
// R2 speaks the S3 API, so we use the AWS S3 SDK pointed at the R2 endpoint
// rather than hand-rolling SigV4 (signing is exactly the kind of
// security-sensitive code not to hand-roll — see ADR 0005, alternatives).
//
// This is the only file in the package that touches the network. Key
// construction lives in keys.ts so the tenancy-critical logic stays pure and
// testable; every function here calls `assertKeyBelongsToOrg` before it acts.
//
// Signed URLs only — raw object keys never reach the client
// (.claude/rules/architecture.md). Default expiry is 15 minutes
// (.claude/rules/multi-tenancy.md).

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireEnv } from "./env";
import { assertAudioKey, assertKeyBelongsToOrg } from "./keys";

const DEFAULT_EXPIRY_SECONDS = 15 * 60;

let clientSingleton: S3Client | undefined;

function client(): S3Client {
  if (clientSingleton) return clientSingleton;
  const accountId = requireEnv("CLOUDFLARE_R2_ACCOUNT_ID");
  clientSingleton = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv("CLOUDFLARE_R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
    },
  });
  return clientSingleton;
}

function bucket(): string {
  return requireEnv("CLOUDFLARE_R2_BUCKET");
}

export type SignedUploadArgs = {
  key: string;
  org_id: string;
  contentType: string;
  expiresInSeconds?: number;
};

// A short-lived URL the browser PUTs the finished recording to. Scoped to one
// exact key and content type — the client cannot redirect the upload
// elsewhere or overwrite an arbitrary object.
export async function signedUploadUrl(args: SignedUploadArgs): Promise<string> {
  assertKeyBelongsToOrg(args.key, args.org_id);
  return getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: args.key,
      ContentType: args.contentType,
    }),
    { expiresIn: args.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS },
  );
}

export type SignedDownloadArgs = {
  key: string;
  org_id: string;
  expiresInSeconds?: number;
};

// A short-lived URL for playback in the browser (results page).
export async function signedDownloadUrl(
  args: SignedDownloadArgs,
): Promise<string> {
  assertKeyBelongsToOrg(args.key, args.org_id);
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: bucket(), Key: args.key }),
    { expiresIn: args.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS },
  );
}

export type DownloadObjectArgs = {
  key: string;
  org_id: string;
};

// Server-side fetch of the raw bytes — used by the transcription +
// audio-feature pass, which runs in a server action, not the browser.
export async function downloadObject(
  args: DownloadObjectArgs,
): Promise<Uint8Array> {
  assertKeyBelongsToOrg(args.key, args.org_id);
  const res = await client().send(
    new GetObjectCommand({ Bucket: bucket(), Key: args.key }),
  );
  if (!res.Body) {
    throw new Error(`R2 object ${args.key} had no body.`);
  }
  return res.Body.transformToByteArray();
}

// Delete a recording object. Used by the data-retention job (90-day purge)
// and erasure execution — both system-level, not request-scoped. We still run
// the structural recording-key guard so a stray non-recording key (e.g. a
// global audio-cache object) can never be deleted through this path.
export async function deleteObject(key: string): Promise<void> {
  // recordingKey shape is `recordings/{org}/{user}/{attempt}.{ext}`; the org
  // guard needs the org segment, which we can read off the key itself.
  const orgSegment = key.split("/")[1];
  if (!orgSegment) throw new Error(`Refusing to delete malformed key: ${key}`);
  assertKeyBelongsToOrg(key, orgSegment);
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

// ─── Global audio cache operations (Listening TTS) ──────────────────────
//
// Audio cache objects are GLOBAL (`audio/{sha256}.{ext}` — see ADR 0007 D5)
// and live outside any org prefix. The org-level guard does not apply; we
// use the structural `assertAudioKey` guard instead so a recording key
// cannot accidentally be passed in.
//
// These ops run server-side only — the TTS cache layer in `@elc/ai` calls
// them at SuperAdmin-approval time, never from the browser.

export type AudioObjectExistsArgs = { key: string };

// HeadObject is a cheap existence check — no body returned, no egress.
// Returns false on the S3 "NoSuchKey" / 404 family; rethrows on auth/
// network errors so the caller sees a real problem rather than silent miss.
export async function audioObjectExists(
  args: AudioObjectExistsArgs,
): Promise<boolean> {
  assertAudioKey(args.key);
  try {
    await client().send(
      new HeadObjectCommand({ Bucket: bucket(), Key: args.key }),
    );
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

export type PutAudioObjectArgs = {
  key: string;
  bytes: Uint8Array;
  contentType: string;
};

// Server-side bytes upload for TTS-synthesised audio. The server already
// holds the bytes (returned by ElevenLabs); we don't bother with a presigned
// PUT URL the way recordings do, because nothing on the client side ever
// produces audio for the cache.
export async function putAudioObject(args: PutAudioObjectArgs): Promise<void> {
  assertAudioKey(args.key);
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: args.key,
      Body: args.bytes,
      ContentType: args.contentType,
    }),
  );
}

export type SignedAudioDownloadArgs = {
  key: string;
  expiresInSeconds?: number;
};

// Short-lived URL for in-browser <audio> playback. The CALLER is responsible
// for org-level authorisation (e.g. verifying the requester has an Attempt
// against the parent Test) — audio objects are global, so this minter does
// not check org_id.
export async function signedAudioDownloadUrl(
  args: SignedAudioDownloadArgs,
): Promise<string> {
  assertAudioKey(args.key);
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: bucket(), Key: args.key }),
    { expiresIn: args.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS },
  );
}

// Best-effort detection of an S3 "object does not exist" error. The S3
// client surfaces this as either a `NotFound` name (HeadObject) or a 404
// status; we recognise both rather than coupling to one SDK version.
function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  if (e.name === "NotFound" || e.name === "NoSuchKey") return true;
  const status = e.$metadata?.httpStatusCode;
  return status === 404;
}
