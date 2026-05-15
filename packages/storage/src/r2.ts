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
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireEnv } from "./env";
import { assertKeyBelongsToOrg } from "./keys";

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
