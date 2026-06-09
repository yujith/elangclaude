"use server";

// SuperAdmin branding reset (ADR-0023). Cross-org by design — goes through
// withSuperAdminContext inside resetBrandingForOrgAsSuperAdmin, logs
// super.branding.reset under SYSTEM_ORG_ID. The target org id comes from the
// form on /orgs/[orgId], which is a SuperAdmin-only surface; the helper
// no-ops for unknown orgs and refuses the system org.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resetBrandingForOrgAsSuperAdmin } from "@elc/db/org-branding";
import { deleteBrandingLogo } from "@elc/storage";
import { requireRole } from "@/lib/auth/context";

export async function resetOrgBrandingFromForm(
  formData: FormData,
): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const orgId = formData.get("org_id");
  if (typeof orgId !== "string" || orgId.length === 0) {
    redirect("/orgs?error=not_found");
  }

  const { removed_logo_object_key } = await resetBrandingForOrgAsSuperAdmin(
    ctx,
    orgId,
  );
  if (removed_logo_object_key) {
    try {
      // The structural key guard runs against the TARGET org's id (read off
      // its own DB row inside the reset helper) — never a request value.
      await deleteBrandingLogo({
        key: removed_logo_object_key,
        org_id: orgId,
      });
    } catch {
      // Orphaned object only — never fail the reset.
    }
  }

  revalidatePath(`/orgs/${orgId}`);
  redirect(`/orgs/${orgId}?branding_reset=1`);
}
