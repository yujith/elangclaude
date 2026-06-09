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
  audioKey,
  assertAudioKey,
  audioExtensionForMimeType,
} from "./keys";
export type { AudioKeyParts, AudioExtension } from "./keys";

export {
  signedUploadUrl,
  signedDownloadUrl,
  downloadObject,
  deleteObject,
} from "./r2";
export type {
  SignedUploadArgs,
  SignedDownloadArgs,
  DownloadObjectArgs,
} from "./r2";

export {
  audioObjectExists,
  putAudioObject,
  signedAudioDownloadUrl,
} from "./r2";
export type {
  AudioObjectExistsArgs,
  PutAudioObjectArgs,
  SignedAudioDownloadArgs,
} from "./r2";

export {
  brandingLogoKey,
  assertBrandingLogoKey,
  logoExtensionForMimeType,
} from "./keys";
export type { BrandingLogoKeyParts, LogoExtension } from "./keys";

export { sniffImageType } from "./image-sniff";
export type { SniffedImageType } from "./image-sniff";

export {
  putBrandingLogo,
  signedBrandingLogoUrl,
  deleteBrandingLogo,
} from "./r2";
export type {
  PutBrandingLogoArgs,
  SignedBrandingLogoArgs,
  DeleteBrandingLogoArgs,
} from "./r2";
