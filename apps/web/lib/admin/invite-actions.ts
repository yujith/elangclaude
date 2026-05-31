"use server";

// OrgAdmin learner server actions.
//
// Thin wrappers around the pure helpers in @elc/db/admin-invite and
// @elc/db/org-learner-admin. Phase 2 thin slice: no email is sent. Invites
// create a dormant Learner keyed by email; when Clerk lands, the first
// sign-in matches by email and lands in the right org.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  inviteLearnerForOrg,
  inviteLearnersFromCsvForOrg,
  type CsvInviteResult,
  type InviteResult,
} from "@elc/db/admin-invite";
import {
  softDeleteLearnerForOrg,
  updateLearnerForOrg,
  type OrgLearnerFailureReason,
} from "@elc/db/org-learner-admin";
import { requireRole } from "@/lib/auth/context";

export type {
  InviteFailureReason,
  InviteResult,
  CsvInviteResult,
  CsvRowResult,
} from "@elc/db/admin-invite";
export type { OrgLearnerFailureReason } from "@elc/db/org-learner-admin";

function readString(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function safeLearnersReturnTo(raw: FormDataEntryValue | null): string {
  if (typeof raw !== "string") return "/admin/learners";
  if (raw === "/admin/learners" || raw.startsWith("/admin/learners?")) {
    return raw;
  }
  return "/admin/learners";
}

function withStatusParam(
  href: string,
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL(href, "http://elc.local");
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
}

function failureRedirect(
  reason: OrgLearnerFailureReason,
  focusUserId?: string | null,
  returnTo = "/admin/learners",
): never {
  redirect(
    withStatusParam(returnTo, {
      error: reason,
      focus: focusUserId,
    }),
  );
}

export async function inviteLearner(input: {
  email: string;
  name?: string | null;
}): Promise<InviteResult> {
  const ctx = await requireRole("OrgAdmin");
  const result = await inviteLearnerForOrg(ctx, input);
  if (result.ok) {
    revalidatePath("/admin");
    revalidatePath("/admin/learners");
    revalidatePath("/admin/invite");
    revalidatePath("/admin/activity");
  }
  return result;
}

export async function updateLearnerFromForm(formData: FormData): Promise<void> {
  const ctx = await requireRole("OrgAdmin");
  const returnTo = safeLearnersReturnTo(formData.get("return_to"));
  const userId = readString(formData, "user_id");
  if (!userId) failureRedirect("learner_not_found", null, returnTo);

  const result = await updateLearnerForOrg(ctx, {
    user_id: userId,
    email: (formData.get("email") as string) ?? "",
    name: (formData.get("name") as string | null) ?? undefined,
    ielts_track: (formData.get("ielts_track") as "Academic" | "GeneralTraining") ?? "Academic",
  });
  if (!result.ok) failureRedirect(result.reason, userId, returnTo);

  revalidatePath("/admin");
  revalidatePath("/admin/learners");
  revalidatePath("/admin/activity");
  redirect(
    withStatusParam(returnTo, {
      updated: result.user_id,
      focus: result.user_id,
    }),
  );
}

export async function softDeleteLearnerFromForm(
  formData: FormData,
): Promise<void> {
  const ctx = await requireRole("OrgAdmin");
  const returnTo = safeLearnersReturnTo(formData.get("return_to"));
  const userId = readString(formData, "user_id");
  if (!userId) failureRedirect("learner_not_found", null, returnTo);

  const result = await softDeleteLearnerForOrg(ctx, { user_id: userId });
  if (!result.ok) failureRedirect(result.reason, userId, returnTo);

  revalidatePath("/admin");
  revalidatePath("/admin/learners");
  revalidatePath("/admin/activity");
  redirect(withStatusParam(returnTo, { removed: result.user_id }));
}

export async function inviteLearnersFromCsv(
  text: string,
): Promise<CsvInviteResult> {
  const ctx = await requireRole("OrgAdmin");
  const result = await inviteLearnersFromCsvForOrg(ctx, text);
  if (result.invited > 0) {
    revalidatePath("/admin");
    revalidatePath("/admin/learners");
    revalidatePath("/admin/invite");
    revalidatePath("/admin/activity");
  }
  return result;
}
