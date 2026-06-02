"use client";

import { openConsentPreferences } from "./consent-store";

// Re-opens the consent preferences dialog. Used on the Cookie Policy page so
// visitors can change their mind at any time (a GDPR/PDPA requirement).
export function CookiePreferencesButton() {
  return (
    <button
      type="button"
      onClick={openConsentPreferences}
      className="rounded-pill bg-brand-black px-5 py-2.5 font-heading font-bold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
    >
      Manage cookie preferences
    </button>
  );
}
