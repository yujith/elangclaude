// Public surface for `@elc/storage`.
//
// Cloudflare R2 access for tenant-scoped object storage. Speaking recordings
// are the first and only consumer in v1. Keep this file thin — only the
// symbols consumers actually use.

export {
  recordingKey,
  assertKeyBelongsToOrg,
  extensionForMimeType,
} from "./keys";
export type { RecordingKeyParts, RecordingExtension } from "./keys";

export {
  signedUploadUrl,
  signedDownloadUrl,
  downloadObject,
} from "./r2";
export type {
  SignedUploadArgs,
  SignedDownloadArgs,
  DownloadObjectArgs,
} from "./r2";
