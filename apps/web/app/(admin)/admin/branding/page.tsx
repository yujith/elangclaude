// OrgAdmin branding editor — /admin/branding (ADR-0023).
//
// This page is PLATFORM-branded chrome (it lives under the themed admin
// layout, so the org's own theme shows around it — that's the point: the
// admin edits the theme while standing inside it). All allowlisted fonts get
// @font-face here so the picker specimens render; learner pages only ever
// load the org's single chosen font.

import type { Metadata } from "next";
import { BRANDING_FONTS, type BrandingFontKey } from "@elc/db/branding";
import { getOrgBrandingSnapshot } from "@elc/db/org-branding";
import { BrandingEditor } from "@/components/admin/branding-editor";
import { LogoUploadPanel } from "@/components/admin/logo-upload-panel";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { requireRole } from "@/lib/auth/context";
import {
  removeLogoFromForm,
  resetBrandingFromForm,
} from "@/lib/admin/branding-actions";
import { orgFontFaceCss } from "@/lib/branding/fonts";

export const metadata: Metadata = {
  title: "Branding · eLanguage Center",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function allFontFacesCss(): string {
  return (Object.keys(BRANDING_FONTS) as BrandingFontKey[])
    .map((key) => orgFontFaceCss(key))
    .filter((css): css is string => css !== null)
    .join("\n");
}

export default async function AdminBrandingPage() {
  const ctx = await requireRole("OrgAdmin");
  const snapshot = await getOrgBrandingSnapshot(ctx);

  const initial = {
    primary_color: snapshot.theme.primary_color,
    surface_dark_color: snapshot.theme.surface_dark_color,
    font_key: snapshot.theme.font_key,
  };
  const hasLogo = Boolean(snapshot.row?.logo_object_key);
  const logoVersion = snapshot.row?.logo_updated_at?.getTime() ?? 0;

  return (
    <section className="px-6 py-12 md:py-16">
      {/* Font specimens for the picker — allowlist-only content. */}
      <style dangerouslySetInnerHTML={{ __html: allFontFacesCss() }} />
      <div className="mx-auto max-w-5xl space-y-12">
        <header>
          {/* red-dark, not red: 14px on grey-50 needs ≥4.5:1 (red is 3.88) */}
          <p className="font-body text-sm uppercase tracking-widest text-brand-red-dark">
            Admin
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Branding.
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
            Make eLanguage Center look like <em>your</em> school. Your colours,
            font, and logo apply across your admin pages and everything your
            learners see. Readability is checked automatically — combinations
            that would be hard to read can&apos;t be saved.
          </p>
        </header>

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
          <h2 className="font-heading font-bold text-2xl text-brand-black">
            Colours &amp; font
          </h2>
          <div className="mt-6">
            <BrandingEditor initial={initial} />
          </div>
        </section>

        <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
          <h2 className="font-heading font-bold text-2xl text-brand-black">
            Logo
          </h2>
          <p className="mt-1 font-body text-sm text-brand-grey-700 max-w-2xl">
            PNG, JPEG, or WebP up to 1&nbsp;MB. Shown on a white plate in the
            header so it stays visible whatever colours it uses. A wide
            (landscape) export looks best.
          </p>
          <div className="mt-5 flex flex-wrap items-start gap-8">
            <div>
              <p className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
                Current
              </p>
              <div className="mt-2 inline-flex items-center rounded-md bg-brand-grey-50 ring-1 ring-brand-grey-200 px-4 py-3">
                {hasLogo ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- signed-URL redirect, unknown dimensions */
                  <img
                    src={`/api/branding/logo?v=${logoVersion}`}
                    alt="Current organisation logo"
                    className="h-10 w-auto max-w-56 object-contain"
                  />
                ) : (
                  <p className="font-body text-sm text-brand-grey-700">
                    No logo uploaded — learners see the eLanguage Center logo.
                  </p>
                )}
              </div>
              {hasLogo ? (
                <form action={removeLogoFromForm} className="mt-3">
                  <ConfirmSubmitButton
                    confirmMessage="Remove your logo? Learners will see the eLanguage Center logo again."
                    pendingLabel="Removing…"
                    className="font-heading font-bold text-sm text-brand-red-dark hover:text-brand-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red rounded-sm disabled:opacity-60"
                  >
                    Remove logo
                  </ConfirmSubmitButton>
                </form>
              ) : null}
            </div>
            <div className="grow max-w-md">
              <LogoUploadPanel />
            </div>
          </div>
        </section>

        <section className="rounded-lg bg-brand-grey-50 ring-1 ring-brand-grey-200 p-6">
          <h2 className="font-heading font-bold text-xl text-brand-black">
            Start over
          </h2>
          <p className="mt-1 font-body text-sm text-brand-grey-700 max-w-2xl">
            Remove your colours, font, and logo and return to the default
            eLanguage Center look.
          </p>
          <form action={resetBrandingFromForm} className="mt-4">
            <ConfirmSubmitButton
              confirmMessage="Reset all branding to the eLanguage Center default? Your logo will be deleted."
              pendingLabel="Resetting…"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white ring-1 ring-brand-grey-200 hover:ring-brand-red text-brand-black font-heading font-bold text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red disabled:opacity-60"
            >
              Reset to default
            </ConfirmSubmitButton>
          </form>
        </section>
      </div>
    </section>
  );
}
