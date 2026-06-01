// Cookie-consent primitives shared by client and server (ADR-0019).
//
// Anonymous visitors' choices live in this first-party cookie only — no PII,
// no server row. Once the chooser is an authenticated user we snapshot the
// choice into the ConsentRecord ledger via /api/consent. Strictly necessary
// cookies (sign-in, billing) are exempt and never gated.

export const CONSENT_COOKIE = "elc_consent";
export const CONSENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // 180 days

export type ConsentChoice = {
  /** Cookie policy version this choice was made against. */
  v: string;
  functional: boolean;
  analytics: boolean;
  /** ISO timestamp of the choice. */
  ts: string;
};

export function parseConsentCookie(raw: string | undefined | null): ConsentChoice | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (
      parsed &&
      typeof parsed.v === "string" &&
      typeof parsed.functional === "boolean" &&
      typeof parsed.analytics === "boolean"
    ) {
      return parsed as ConsentChoice;
    }
  } catch {
    // fall through
  }
  return null;
}

/** True when a stored choice matches the current cookie-policy version. */
export function isChoiceCurrent(choice: ConsentChoice | null, version: string): boolean {
  return choice !== null && choice.v === version;
}
