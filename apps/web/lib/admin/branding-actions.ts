"use server";

// OrgAdmin branding server actions (ADR-0023).
//
// Thin wrappers around @elc/db/org-branding: requireRole("OrgAdmin") first,
// org always from the session ctx. Colour/font validation is server-side in
// validateBranding() — the editor's live preview is advisory only and a
// devtools-tampered palette is re-rejected here.
//
// Logo uploads run entirely server-side: magic-byte sniff + size cap before
// the bytes touch R2, raster only (SVG can embed script and is refused even
// if the browser lies about the MIME type). Replaced/reset logos are deleted
// from R2 best-effort — an orphaned object is a cost nuisance, not a
// correctness problem, so R2 failures never roll back the DB write.

import { revalidatePath } from "next/cache";
import {
  removeOrgLogoForOrg,
  resetOrgBrandingForOrg,
  saveOrgBrandingForOrg,
  setOrgLogoForOrg,
  type SaveBrandingResult,
} from "@elc/db/org-branding";
import {
  brandingLogoKey,
  deleteBrandingLogo,
  putBrandingLogo,
  sniffImageType,
} from "@elc/storage";
import { requireRole } from "@/lib/auth/context";

export type { BrandingFailureReason } from "@elc/db/branding";
export type { SaveBrandingResult } from "@elc/db/org-branding";

export const MAX_LOGO_BYTES = 1024 * 1024; // 1 MB

export type LogoUploadResult =
  | { ok: true }
  | { ok: false; reason: "missing_file" | "too_large" | "unsupported_format" };

const BRANDING_PATHS = ["/admin/branding", "/admin", "/admin/activity"];

function revalidateBrandedSurfaces(): void {
  for (const path of BRANDING_PATHS) revalidatePath(path);
  // The theme rides on the role layouts, so branded chrome everywhere
  // under them re-renders on next navigation.
  revalidatePath("/", "layout");
}

export async function saveBranding(input: {
  primary_color: string;
  surface_dark_color: string;
  font_key: string;
}): Promise<SaveBrandingResult> {
  const ctx = await requireRole("OrgAdmin");
  const result = await saveOrgBrandingForOrg(ctx, input);
  if (result.ok) revalidateBrandedSurfaces();
  return result;
}

export async function resetBranding(): Promise<{ ok: true }> {
  const ctx = await requireRole("OrgAdmin");
  const { removed_logo_object_key } = await resetOrgBrandingForOrg(ctx);
  if (removed_logo_object_key) {
    try {
      await deleteBrandingLogo({
        key: removed_logo_object_key,
        org_id: ctx.org_id,
      });
    } catch {
      // Orphaned object only — never fail the reset.
    }
  }
  revalidateBrandedSurfaces();
  return { ok: true };
}

export async function uploadLogo(
  formData: FormData,
): Promise<LogoUploadResult> {
  const ctx = await requireRole("OrgAdmin");

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, reason: "missing_file" };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    return { ok: false, reason: "unsupported_format" };
  }

  const key = brandingLogoKey({
    org_id: ctx.org_id,
    extension: sniffed.extension,
  });
  await putBrandingLogo({
    key,
    org_id: ctx.org_id,
    bytes,
    contentType: sniffed.contentType,
  });

  const { previous_logo_object_key } = await setOrgLogoForOrg(ctx, {
    logo_object_key: key,
  });
  // Same org + same basename means a same-format replace overwrites in
  // place; only a format change leaves an old object behind.
  if (previous_logo_object_key) {
    try {
      await deleteBrandingLogo({
        key: previous_logo_object_key,
        org_id: ctx.org_id,
      });
    } catch {
      // Orphaned object only.
    }
  }

  revalidateBrandedSurfaces();
  return { ok: true };
}

export async function removeLogo(): Promise<{ ok: true }> {
  const ctx = await requireRole("OrgAdmin");
  const { removed_logo_object_key } = await removeOrgLogoForOrg(ctx);
  if (removed_logo_object_key) {
    try {
      await deleteBrandingLogo({
        key: removed_logo_object_key,
        org_id: ctx.org_id,
      });
    } catch {
      // Orphaned object only.
    }
  }
  revalidateBrandedSurfaces();
  return { ok: true };
}
