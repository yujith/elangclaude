"use server";

// OrgAdmin invite server actions — thin wrappers around the pure helpers
// in @elc/db/admin-invite. Phase 2 thin slice: no email sent. We create
// a dormant User row keyed by email; when Clerk lands, the first sign-in
// matches by email and lands in the right org. Cross-org email collisions
// return a generic "cannot_invite" so admins can't enumerate.

import { revalidatePath } from "next/cache";
import {
  inviteLearnerForOrg,
  inviteLearnersFromCsvForOrg,
  type CsvInviteResult,
  type InviteResult,
} from "@elc/db/admin-invite";
import { requireRole } from "@/lib/auth/context";

export type { InviteFailureReason, InviteResult, CsvInviteResult, CsvRowResult } from "@elc/db/admin-invite";

export async function inviteLearner(input: {
  email: string;
  name?: string | null;
}): Promise<InviteResult> {
  const ctx = await requireRole("OrgAdmin");
  const result = await inviteLearnerForOrg(ctx, input);
  if (result.ok) {
    revalidatePath("/admin");
    revalidatePath("/admin/learners");
    revalidatePath("/admin/activity");
  }
  return result;
}

export async function inviteLearnersFromCsv(
  text: string,
): Promise<CsvInviteResult> {
  const ctx = await requireRole("OrgAdmin");
  const result = await inviteLearnersFromCsvForOrg(ctx, text);
  if (result.invited > 0) {
    revalidatePath("/admin");
    revalidatePath("/admin/learners");
    revalidatePath("/admin/activity");
  }
  return result;
}
