"use client";

// Org logo upload panel (ADR-0023). useActionState so server-side rejection
// reasons (size, format) surface inline. The server action re-sniffs the
// bytes — the accept= filter is a convenience, not the gate.

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  uploadLogoAction,
  type LogoUploadResult,
} from "@/lib/admin/branding-actions";
import { Spinner } from "@/components/ui/spinner";

const REASON_COPY: Record<
  Exclude<LogoUploadResult, { ok: true }>["reason"],
  string
> = {
  missing_file: "Choose an image file first.",
  too_large: "That file is over 1 MB. Export a smaller PNG, JPEG, or WebP.",
  unsupported_format:
    "That file isn't a PNG, JPEG, or WebP image. SVG isn't supported.",
};

function UploadButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-brand-black hover:bg-brand-grey-900 text-white font-heading font-bold text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <Spinner size="sm" decorative />
          Uploading…
        </span>
      ) : (
        "Upload logo"
      )}
    </button>
  );
}

export function LogoUploadPanel() {
  const [state, formAction] = useActionState<LogoUploadResult | null, FormData>(
    uploadLogoAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-3">
      <label
        htmlFor="logo-file"
        className="block font-heading font-bold text-sm text-brand-black"
      >
        Logo file
      </label>
      <input
        id="logo-file"
        type="file"
        name="logo"
        accept="image/png,image/jpeg,image/webp"
        className="block w-full max-w-md font-body text-sm text-brand-grey-700 file:mr-4 file:rounded-full file:border-0 file:bg-brand-grey-100 file:px-4 file:py-2 file:font-heading file:font-bold file:text-sm file:text-brand-black hover:file:bg-brand-grey-200"
      />
      {state && !state.ok ? (
        <p role="alert" className="font-body text-sm text-brand-red-dark">
          {REASON_COPY[state.reason]}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="font-body text-sm text-brand-grey-700">
          Logo updated.
        </p>
      ) : null}
      <UploadButton />
    </form>
  );
}
