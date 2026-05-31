// Offline fallback served by the service worker when a navigation can't reach
// the network (see public/sw.js). Deliberately self-contained and force-static
// so it precaches cleanly and renders with zero auth/server dependencies.

import type { Metadata } from "next";
import { Wordmark } from "@/components/wordmark";
import { OfflineRetryButton } from "@/components/pwa/offline-retry-button";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "You're offline",
  description: "eLanguage Center can't reach the network right now.",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main className="flex-1 bg-brand-grey-50">
      <div className="mx-auto max-w-md px-6 py-20 md:py-28">
        <div className="rounded-lg bg-brand-white p-8 md:p-10 ring-1 ring-brand-grey-200">
          <Wordmark />
          {/* brand-red-dark, not brand-red: #EE2346 on white is 4.23:1 (below
              WCAG AA 4.5:1 for this small label). See the AA note in ADR-0019. */}
          <p className="mt-8 font-body text-sm uppercase tracking-widest text-brand-red-dark">
            No connection
          </p>
          <h1 className="mt-3 font-heading font-bold text-3xl text-brand-black">
            You&apos;re offline
          </h1>
          <p className="mt-4 font-body text-base text-brand-grey-700">
            eLanguage Center can&apos;t reach the network right now. Check your
            connection and try again — your progress is saved on our servers, so
            nothing is lost.
          </p>
          <OfflineRetryButton />
        </div>
      </div>
    </main>
  );
}
