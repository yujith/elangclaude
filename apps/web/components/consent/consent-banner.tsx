"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ConsentChoice } from "@/lib/consent/consent";
import {
  onOpenPreferences,
  readConsent,
  syncConsentToServer,
  writeConsent,
} from "./consent-store";

// Cookie consent banner + preferences dialog. Mounted once in the root
// layout. Shows on first visit (or after a policy-version bump) until the
// visitor chooses. "Accept all" and "Reject non-essential" carry equal visual
// weight — consent must be freely given, so no dark patterns. Strictly
// necessary cookies are never gated.
//
// The stored cookie is read via useSyncExternalStore (not an effect) so there
// is no synchronous setState-in-effect, and SSR renders nothing.

const subscribeNoop = () => () => {};

function persist(choice: ConsentChoice) {
  writeConsent(choice);
  void syncConsentToServer(choice);
}

export function ConsentBanner({ version }: { version: string }) {
  const stored = useSyncExternalStore(
    subscribeNoop,
    () => readConsent(),
    () => null,
  );
  const needsChoice = !stored || stored.v !== version;

  // "banner" while waiting for a first choice; "prefs" when the user expands
  // (or re-opens via the Cookie Policy button); null once handled this session.
  const [panel, setPanel] = useState<"banner" | "prefs" | null>(null);
  const [choseThisSession, setChoseThisSession] = useState(false);
  const [functional, setFunctional] = useState(true);
  const [analytics, setAnalytics] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Re-open preferences from anywhere (e.g. the Cookie Policy page).
  useEffect(
    () =>
      onOpenPreferences(() => {
        const existing = readConsent();
        setFunctional(existing?.functional ?? true);
        setAnalytics(existing?.analytics ?? false);
        setChoseThisSession(false);
        setPanel("prefs");
      }),
    [],
  );

  const view: "banner" | "prefs" | "hidden" =
    panel === "prefs"
      ? "prefs"
      : !choseThisSession && needsChoice
        ? (panel ?? "banner")
        : "hidden";

  // Move focus into the panel when it appears (no setState here).
  useEffect(() => {
    if (view !== "hidden") headingRef.current?.focus();
  }, [view]);

  const choose = useCallback(
    (next: { functional: boolean; analytics: boolean }) => {
      persist({ v: version, ...next, ts: new Date().toISOString() });
      setChoseThisSession(true);
      setPanel(null);
    },
    [version],
  );

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setChoseThisSession(true);
      setPanel(null);
    }
  }, []);

  if (view === "hidden") return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="consent-heading"
      onKeyDown={onKeyDown}
      className="fixed inset-x-0 bottom-0 z-50 p-4 sm:p-6"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-brand-grey-200 bg-white shadow-2xl p-6">
        <h2
          id="consent-heading"
          ref={headingRef}
          tabIndex={-1}
          className="font-heading font-bold text-xl text-brand-black focus:outline-none"
        >
          Your privacy choices
        </h2>
        <p className="mt-2 font-body text-sm text-brand-grey-900 leading-relaxed">
          We use strictly necessary cookies to run the site. With your consent
          we also use functional and analytics cookies to improve eLanguage
          Center. Read our{" "}
          <Link
            href="/cookies"
            className="text-brand-red underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red rounded-sm"
          >
            Cookie Policy
          </Link>
          .
        </p>

        {view === "prefs" && (
          <fieldset className="mt-4 space-y-3 border-t border-brand-grey-200 pt-4">
            <legend className="sr-only">Cookie categories</legend>
            <Row label="Strictly necessary" desc="Always on — required to sign in and use the service." checked disabled />
            <Row
              label="Functional"
              desc="Remember preferences like your IELTS track."
              checked={functional}
              onChange={setFunctional}
            />
            <Row
              label="Analytics"
              desc="Help us understand usage and fix problems."
              checked={analytics}
              onChange={setAnalytics}
            />
          </fieldset>
        )}

        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          {view === "prefs" ? (
            <button
              type="button"
              onClick={() => choose({ functional, analytics })}
              className="rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              Save choices
            </button>
          ) : (
            <button
              type="button"
              onClick={() => choose({ functional: true, analytics: true })}
              className="rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              Accept all
            </button>
          )}
          <button
            type="button"
            onClick={() => choose({ functional: false, analytics: false })}
            className="rounded-pill border-2 border-brand-black px-5 py-2.5 font-heading font-bold text-brand-black hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
          >
            Reject non-essential
          </button>
          {view === "banner" && (
            <button
              type="button"
              onClick={() => setPanel("prefs")}
              className="rounded-pill px-5 py-2.5 font-heading font-bold text-brand-grey-900 underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
            >
              Preferences
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  desc,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="mt-1 h-4 w-4 accent-brand-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
      />
      <span>
        <span className="block font-heading font-bold text-sm text-brand-black">{label}</span>
        <span className="block font-body text-xs text-brand-grey-500">{desc}</span>
      </span>
    </label>
  );
}
