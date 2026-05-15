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

export type RecordingKeyParts = {
  org_id: string;
  user_id: string;
  attempt_id: string;
};

// recordings/{org_id}/{user_id}/{attempt_id}.webm
export function recordingKey(parts: RecordingKeyParts): string {
  assertIdSafe("org_id", parts.org_id);
  assertIdSafe("user_id", parts.user_id);
  assertIdSafe("attempt_id", parts.attempt_id);
  return `recordings/${parts.org_id}/${parts.user_id}/${parts.attempt_id}.webm`;
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
