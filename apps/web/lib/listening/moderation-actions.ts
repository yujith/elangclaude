"use server";

// SuperAdmin-only moderation actions for Listening tests.
//
// Test/Question are global models — withOrg() would pass them through
// unscoped anyway — so we use withSuperAdminContext() per the multi-
// tenancy rule. NEVER mix the two helpers in the same function.
//
// Approval in v1 ONLY flips status; Phase 5 will additionally trigger
// TTS synth on approve via the cache layer. The hook lands there, not
// here.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, withSuperAdminContext } from "@elc/db";
import { requireRole } from "@/lib/auth/context";

export type ListeningModerationResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "wrong_state" | "wrong_section" };

async function loadTestForModeration(testId: string): Promise<{
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

export async function approveListeningTest(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = formData.get("testId");
  if (typeof testId !== "string" || testId.length === 0) {
    throw new Error("Missing testId.");
  }
  const db = withSuperAdminContext(ctx);
  const test = await loadTestForModeration(testId);
  if (!test) throw new Error("Test not found.");
  if (test.section !== "Listening") {
    throw new Error("Only Listening tests can be moderated here.");
  }
  if (test.status !== "PendingReview") {
    if (test.status === "Approved") {
      redirect(`/content/listening/${testId}?approved=1`);
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
      action: "content.listening.approved",
      metadata: { test_id: test.id } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/content/listening");
  redirect("/content/listening?approved=" + test.id);
}

export async function rejectListeningTest(formData: FormData): Promise<void> {
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
  if (test.section !== "Listening") {
    throw new Error("Only Listening tests can be moderated here.");
  }
  if (test.status !== "PendingReview") {
    if (test.status === "Rejected") {
      redirect(`/content/listening?rejected=${testId}`);
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
      action: "content.listening.rejected",
      metadata: {
        test_id: test.id,
        reason: reason ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/content/listening");
  redirect("/content/listening?rejected=" + test.id);
}
