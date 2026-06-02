"use client";

// Client-side consent store: reads/writes the first-party consent cookie,
// notifies subscribers, and lets any component re-open the preferences UI via
// a custom event. Kept framework-light so the banner and the cookie-policy
// page button can share one source of truth.

import {
  CONSENT_COOKIE,
  CONSENT_COOKIE_MAX_AGE,
  parseConsentCookie,
  type ConsentChoice,
} from "@/lib/consent/consent";

const OPEN_PREFS_EVENT = "elc:open-consent-preferences";

function rawConsentCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${CONSENT_COOKIE}=`));
  return match ? match.slice(CONSENT_COOKIE.length + 1) : null;
}

export function readConsent(): ConsentChoice | null {
  return parseConsentCookie(rawConsentCookie());
}

// Cached snapshot for useSyncExternalStore. getSnapshot MUST return a
// referentially-stable value when the underlying state is unchanged —
// re-parsing the cookie into a fresh object on every call makes React think
// the store changed each render and throws "Maximum update depth exceeded"
// (React error #185). We re-parse only when the raw cookie string changes.
let cachedRaw: string | null = null;
let cachedChoice: ConsentChoice | null = null;
let cachedInit = false;

export function getConsentSnapshot(): ConsentChoice | null {
  const raw = rawConsentCookie();
  if (cachedInit && raw === cachedRaw) return cachedChoice;
  cachedRaw = raw;
  cachedChoice = parseConsentCookie(raw);
  cachedInit = true;
  return cachedChoice;
}

export function writeConsent(choice: ConsentChoice): void {
  if (typeof document === "undefined") return;
  const value = encodeURIComponent(JSON.stringify(choice));
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${value}; path=/; Max-Age=${CONSENT_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  // Keep the cached snapshot in sync so the next read is stable + current.
  cachedRaw = value;
  cachedChoice = choice;
  cachedInit = true;
}

/** Persist the authenticated user's choice to the consent ledger (best-effort). */
export async function syncConsentToServer(choice: ConsentChoice): Promise<void> {
  try {
    await fetch("/api/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(choice),
      keepalive: true,
    });
  } catch {
    // Anonymous visitors / network errors: the cookie still holds the choice.
  }
}

export function openConsentPreferences(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_PREFS_EVENT));
}

export function onOpenPreferences(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(OPEN_PREFS_EVENT, handler);
  return () => window.removeEventListener(OPEN_PREFS_EVENT, handler);
}
