"use client";

// OrgAdmin branding editor (ADR-0023).
//
// The live preview and inline warnings run the SAME pure validateBranding()
// the server action re-runs on save — the preview is advisory, the server is
// the gate. Specimen rendering assumes the page emitted @font-face rules for
// every allowlisted font (the server page does).

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BRANDING_FONTS,
  brandingCssVariables,
  deriveBrandingPalette,
  validateBranding,
  type BrandingFailureReason,
  type BrandingFontKey,
} from "@elc/db/branding";
import { saveBranding } from "@/lib/admin/branding-actions";
import { PendingButton } from "@/components/ui/pending-button";

const REASON_COPY: Record<BrandingFailureReason, string> = {
  invalid_primary_color: "Enter the accent as a hex colour, e.g. #EE2346.",
  invalid_surface_color: "Enter the surface as a hex colour, e.g. #0A0A0A.",
  unknown_font: "Pick a font from the list.",
  accent_unreadable_on_light:
    "This accent is too pale to read on white surfaces. Pick a darker, more saturated shade.",
  accent_unreadable_on_dark:
    "The accent and the dark surface are too close — links and buttons would vanish on the header. Move one of them.",
  cta_text_unreadable:
    "Button text wouldn't be readable on this accent. Pick a lighter or darker shade.",
  dark_surface_too_light:
    "The surface colour must stay dark enough to carry white text. Pick a deeper shade.",
};

type Props = {
  initial: {
    primary_color: string;
    surface_dark_color: string;
    font_key: string;
  };
};

function ColorField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const pickerSafe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <div>
      <label
        htmlFor={id}
        className="block font-heading font-bold text-sm text-brand-black"
      >
        {label}
      </label>
      <p className="mt-0.5 font-body text-xs text-brand-grey-500">{hint}</p>
      <div className="mt-2 flex items-center gap-3">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={pickerSafe}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-12 cursor-pointer rounded-md border border-brand-grey-200 bg-white p-1"
        />
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="w-32 rounded-md border border-brand-grey-200 bg-white px-3 py-2 font-body text-sm text-brand-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
        />
      </div>
    </div>
  );
}

export function BrandingEditor({ initial }: Props) {
  const router = useRouter();
  const [primary, setPrimary] = React.useState(initial.primary_color);
  const [surface, setSurface] = React.useState(initial.surface_dark_color);
  const [fontKey, setFontKey] = React.useState(initial.font_key);
  const [pending, startTransition] = React.useTransition();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const checked = validateBranding({
    primary_color: primary,
    surface_dark_color: surface,
    font_key: fontKey,
  });

  const previewTheme = checked.ok ? checked.value : null;
  const previewVars = previewTheme
    ? (brandingCssVariables(previewTheme) as React.CSSProperties)
    : undefined;
  const previewPalette = previewTheme
    ? deriveBrandingPalette(previewTheme)
    : null;

  function save() {
    setServerError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveBranding({
        primary_color: primary,
        surface_dark_color: surface,
        font_key: fontKey,
      });
      if (!result.ok) {
        setServerError(REASON_COPY[result.reason]);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* ── Controls ── */}
      <div className="space-y-6">
        <ColorField
          id="branding-primary"
          label="Accent colour"
          hint="Buttons, links, focus rings — your school's signature colour."
          value={primary}
          onChange={setPrimary}
        />
        <ColorField
          id="branding-surface"
          label="Dark surface"
          hint="The header bar and dark sections. Must stay dark enough for white text."
          value={surface}
          onChange={setSurface}
        />

        <fieldset>
          <legend className="font-heading font-bold text-sm text-brand-black">
            Font
          </legend>
          <p className="mt-0.5 font-body text-xs text-brand-grey-500">
            Applies to headings and body text across your learners&apos;
            pages.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(
              Object.entries(BRANDING_FONTS) as [
                BrandingFontKey,
                (typeof BRANDING_FONTS)[BrandingFontKey],
              ][]
            ).map(([key, font]) => (
              <label
                key={key}
                className={`flex cursor-pointer items-center justify-between rounded-md border px-4 py-3 transition-colors ${
                  fontKey === key
                    ? "border-brand-red ring-1 ring-brand-red bg-brand-red-soft"
                    : "border-brand-grey-200 bg-white hover:border-brand-grey-400"
                }`}
              >
                <span
                  className="font-bold text-base text-brand-black"
                  style={{ fontFamily: `"${font.family}", ${font.fallback}` }}
                >
                  {font.label}
                </span>
                <input
                  type="radio"
                  name="branding-font"
                  value={key}
                  checked={fontKey === key}
                  onChange={() => setFontKey(key)}
                  className="accent-[var(--brand-red)]"
                />
              </label>
            ))}
          </div>
        </fieldset>

        {!checked.ok ? (
          <div
            role="alert"
            className="rounded-lg ring-1 bg-brand-red-soft ring-brand-red/40 px-5 py-3"
          >
            <p className="font-body text-sm text-brand-grey-900">
              {REASON_COPY[checked.reason]}
            </p>
          </div>
        ) : null}
        {serverError ? (
          <div
            role="alert"
            className="rounded-lg ring-1 bg-brand-red-soft ring-brand-red/40 px-5 py-3"
          >
            <p className="font-body text-sm text-brand-grey-900">
              {serverError}
            </p>
          </div>
        ) : null}

        <div className="flex items-center gap-4">
          <PendingButton
            pending={pending}
            pendingLabel="Saving…"
            disabled={!checked.ok}
            onClick={save}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-brand-red-dark hover:bg-brand-black text-white font-heading font-bold border border-brand-red-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Save branding
          </PendingButton>
          {saved ? (
            <p role="status" className="font-body text-sm text-brand-grey-700">
              Saved. Your learners see the new look on their next page load.
            </p>
          ) : null}
        </div>
      </div>

      {/* ── Live preview ── */}
      <div aria-hidden="true">
        <p className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
          Live preview
        </p>
        <div
          className="mt-2 overflow-hidden rounded-lg ring-1 ring-brand-grey-200"
          style={previewVars}
        >
          {previewTheme && previewPalette ? (
            <div style={{ fontFamily: "var(--brand-font-body)" }}>
              <div
                className="flex items-center justify-between px-5 py-3"
                style={{ background: "var(--brand-black)" }}
              >
                <span className="font-bold text-sm text-white">
                  Your academy
                </span>
                <span
                  className="text-xs font-bold"
                  style={{ color: "var(--brand-red)" }}
                >
                  Reading · Writing · Speaking
                </span>
              </div>
              <div className="space-y-4 bg-white px-5 py-6">
                <p
                  className="text-2xl font-bold italic leading-tight"
                  style={{
                    fontFamily: "var(--brand-font-display)",
                    color: "var(--brand-black)",
                  }}
                >
                  Welcome back, Amara.
                </p>
                <p className="text-sm text-brand-grey-700">
                  Your Coherence band rose from 5.5 to 6.5 in 4 weeks. Keep
                  the streak going.
                </p>
                <span
                  className="inline-flex items-center rounded-full px-5 py-2 text-sm font-bold"
                  style={{
                    background: "var(--brand-red)",
                    color: previewPalette.onPrimary,
                  }}
                >
                  Continue practice
                </span>
                <div
                  className="rounded-md px-4 py-2 text-xs text-brand-grey-900"
                  style={{ background: "var(--brand-red-soft)" }}
                >
                  Mock test unlocked — 3 sections to go.
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-brand-grey-50 px-5 py-10 text-center">
              <p className="font-body text-sm text-brand-grey-500">
                Fix the colour warning to see the preview.
              </p>
            </div>
          )}
        </div>
        <p className="mt-2 font-body text-xs text-brand-grey-500">
          Hover/active shades and tinted backgrounds are derived
          automatically so everything stays readable.
        </p>
      </div>
    </div>
  );
}
