"use server";

// SuperAdmin-only moderation actions for Reading tests.
//
// Test/Question are global models — withOrg() would pass them through
// unscoped anyway — so we use withSuperAdminContext() per the multi-
// tenancy rule. NEVER mix the two helpers in the same function.
//
// ActivityLog rows are tenant-scoped, so we log under the SuperAdmin's
// home org. That's the same org that bears the generation cost (ADR
// 0004 D4). When the SuperAdmin moves to a dedicated "system" org in a
// later phase, these logs follow.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, withSuperAdminContext } from "@elc/db";
import { requireRole } from "@/lib/auth/context";

export type ModerationResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "wrong_state" | "wrong_section" };

async function loadTestForModeration(
  testId: string,
): Promise<{
  id: string;
  status: "Draft" | "PendingReview" | "Approved" | "Rejected";
  section: "Reading" | "Listening" | "Writing" | "Speaking";
} | null> {
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);
  const test = await db.test.findUnique({
    where: { id: testId },
    select: { id: true, status: true, section: true },
  });
  return test;
}

export async function approveReadingTest(
  formData: FormData,
): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = formData.get("testId");
  if (typeof testId !== "string" || testId.length === 0) {
    throw new Error("Missing testId.");
  }
  const db = withSuperAdminContext(ctx);
  const test = await loadTestForModeration(testId);
  if (!test) throw new Error("Test not found.");
  if (test.section !== "Reading") {
    throw new Error("Only Reading tests can be moderated here.");
  }
  if (test.status !== "PendingReview") {
    // Idempotent: already-Approved is a no-op redirect.
    if (test.status === "Approved") {
      redirect(`/content/reading/${testId}?approved=1`);
    }
    throw new Error(`Cannot approve a ${test.status} test.`);
  }

  await db.test.update({
    where: { id: test.id },
    data: { status: "Approved", approved_by: ctx.user_id },
  });
  await db.activityLog.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      action: "content.reading.approved",
      metadata: { test_id: test.id } as Prisma.InputJsonValue,
    },
  });

  // The learner picker reads Approved Reading tests on every request
  // (force-dynamic) so no targeted revalidation is needed there. We
  // still bump the moderation list cache for snappier UI.
  revalidatePath("/content/reading");
  redirect("/content/reading?approved=" + test.id);
}

export async function rejectReadingTest(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = formData.get("testId");
  if (typeof testId !== "string" || testId.length === 0) {
    throw new Error("Missing testId.");
  }
  const reasonRaw = formData.get("reason");
  const reason =
    typeof reasonRaw === "string" && reasonRaw.trim().length > 0
      ? reasonRaw.trim().slice(0, 500)
      : undefined;

  const db = withSuperAdminContext(ctx);
  const test = await loadTestForModeration(testId);
  if (!test) throw new Error("Test not found.");
  if (test.section !== "Reading") {
    throw new Error("Only Reading tests can be moderated here.");
  }
  if (test.status !== "PendingReview") {
    if (test.status === "Rejected") {
      redirect(`/content/reading?rejected=${testId}`);
    }
    throw new Error(`Cannot reject a ${test.status} test.`);
  }

  await db.test.update({
    where: { id: test.id },
    data: { status: "Rejected" },
  });
  await db.activityLog.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      action: "content.reading.rejected",
      metadata: {
        test_id: test.id,
        reason: reason ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/content/reading");
  redirect("/content/reading?rejected=" + test.id);
}
