// Dev-only signed session cookie.
//
// The shape is `<userId>.<hex-hmac>`. We use HMAC-SHA256 with a secret
// pulled from DEV_SESSION_SECRET (falls back to a stable dev string so a
// fresh clone "just works" in development). The cookie is HttpOnly + Lax.
//
// This module is intentionally tiny: it does NOT load the user or check
// roles. That lives in `context.ts`. Tests can verify sign/verify here in
// isolation without touching the DB.
//
// Production safety: every consumer (the login page, the dev-login server
// action, the requireOrgContext fallback) refuses to operate when
// NODE_ENV === 'production'. Clerk is the canonical auth path; this
// module is the dev-only escape hatch that keeps `/dev/login` and the
// suspend-gate e2e working without a Clerk session.

import { createHmac, timingSafeEqual } from "node:crypto";

import { SESSION_COOKIE as COOKIE_NAME } from "./session-cookie";
const DEFAULT_DEV_SECRET = "elc-dev-not-for-production";

function secret(): string {
  return process.env.DEV_SESSION_SECRET || DEFAULT_DEV_SECRET;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function makeSessionToken(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

export function verifySessionToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(userId);
  // timingSafeEqual requires equal-length buffers; bail early otherwise.
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
      return null;
    }
  } catch {
    return null;
  }
  return userId;
}

export { SESSION_COOKIE } from "./session-cookie";
