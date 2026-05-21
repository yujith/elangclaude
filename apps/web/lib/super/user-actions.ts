"use server";

// Phase 2 — SuperAdmin server actions for per-org user management.
//
// Thin form-action wrappers around the pure helpers in
// @elc/db/super-user-admin. Each wrapper:
//   1. Verifies the caller via requireRole("SuperAdmin").
//   2. Reads org_id / user_id from FormData (URL-controlled, not
//      authority-controlled — the helpers verify the rows actually exist
//      and refuse cross-org operations on system org / SuperAdmin users).
//   3. Forwards to the pure helper.
//   4. Revalidates the affected /orgs paths and redirects with a
//      friendly query param so the page can surface success/failure.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Role } from "@elc/db";
import {
  inviteOrgAdminForOrg,
  resetUserQuotaTodayAsSuperAdmin,
  setUserRoleAsSuperAdmin,
  softDeleteUserAsSuperAdmin,
  type SuperUserFailureReason,
} from "@elc/db/super-user-admin";
import { requireRole } from "@/lib/auth/context";

const ASSIGNABLE_ROLES: ReadonlySet<Role> = new Set<Role>([
  "OrgAdmin",
  "Learner",
]);

function readString(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function failureRedirect(
  orgId: string | null,
  reason: SuperUserFailureReason,
): never {
  if (orgId) redirect(`/orgs/${orgId}/users?error=${reason}`);
  redirect(`/orgs?error=${reason}`);
}

export async function inviteOrgAdminFromForm(
  formData: FormData,
): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const orgId = readString(formData, "org_id");
  if (!orgId) redirect(`/orgs?error=org_not_found`);

  const result = await inviteOrgAdminForOrg(ctx, {
    org_id: orgId,
    email: formData.get("email") as string,
    name: (formData.get("name") as string | null) ?? undefined,
  });
  if (!result.ok) failureRedirect(orgId, result.reason);
  revalidatePath(`/orgs/${orgId}`);
  revalidatePath(`/orgs/${orgId}/users`);
  redirect(
    `/orgs/${orgId}/users?invited=${result.user_id}${
      result.alreadyExisted ? "&existing=1" : ""
    }`,
  );
}

export async function setUserRoleFromForm(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const orgId = readString(formData, "org_id");
  const userId = readString(formData, "user_id");
  const roleRaw = readString(formData, "role");
  if (!userId || !roleRaw || !ASSIGNABLE_ROLES.has(roleRaw as Role)) {
    failureRedirect(orgId, "invalid_role");
  }
  // Pass the form's org_id as expected_org_id so a tampered or stale
  // form pointing at a different org's user is refused rather than
  // silently mutating the wrong org's roster.
  const result = await setUserRoleAsSuperAdmin(ctx, {
    user_id: userId,
    role: roleRaw as Role,
    expected_org_id: orgId ?? undefined,
  });
  if (!result.ok) failureRedirect(orgId, result.reason);
  if (orgId) {
    revalidatePath(`/orgs/${orgId}`);
    revalidatePath(`/orgs/${orgId}/users`);
    redirect(`/orgs/${orgId}/users?role_changed=${userId}`);
  }
  redirect(`/orgs?role_changed=1`);
}

export async function resetUserQuotaFromForm(
  formData: FormData,
): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const orgId = readString(formData, "org_id");
  const userId = readString(formData, "user_id");
  if (!userId) failureRedirect(orgId, "user_not_found");
  const result = await resetUserQuotaTodayAsSuperAdmin(ctx, {
    user_id: userId,
    expected_org_id: orgId ?? undefined,
  });
  if (!result.ok) failureRedirect(orgId, result.reason);
  if (orgId) {
    revalidatePath(`/orgs/${orgId}`);
    revalidatePath(`/orgs/${orgId}/users`);
    redirect(`/orgs/${orgId}/users?quota_reset=${userId}`);
  }
  redirect(`/orgs?quota_reset=1`);
}

export async function softDeleteUserFromForm(
  formData: FormData,
): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const orgId = readString(formData, "org_id");
  const userId = readString(formData, "user_id");
  if (!userId) failureRedirect(orgId, "user_not_found");
  const result = await softDeleteUserAsSuperAdmin(ctx, {
    user_id: userId,
    expected_org_id: orgId ?? undefined,
  });
  if (!result.ok) failureRedirect(orgId, result.reason);
  if (orgId) {
    revalidatePath(`/orgs/${orgId}`);
    revalidatePath(`/orgs/${orgId}/users`);
    redirect(`/orgs/${orgId}/users?removed=${userId}`);
  }
  redirect(`/orgs?removed=1`);
}
