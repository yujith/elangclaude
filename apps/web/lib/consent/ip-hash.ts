import { createHash } from "node:crypto";

// We store a salted hash of the requester IP on consent records, never the
// raw address (data minimisation — ADR-0019 D5). The salt is per-deployment;
// a missing salt degrades to a constant prefix, which still avoids persisting
// the raw IP. Truncated to 32 hex chars — enough to detect duplicates, not
// enough to be a durable identifier.
const SALT = process.env.CONSENT_IP_SALT ?? "elc-consent";

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const first = ip.split(",")[0]?.trim();
  if (!first) return null;
  return createHash("sha256").update(`${SALT}:${first}`).digest("hex").slice(0, 32);
}
