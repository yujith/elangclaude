"use server";

// SuperAdmin-only moderation actions for Speaking tests.
//
// Test/Question are global models — withOrg() would pass them through
// unscoped anyway — so we use withSuperAdminContext() per the multi-tenancy
// rule. NEVER mix the two helpers in the same function.
//
// ActivityLog rows are tenant-scoped, so we log under the SuperAdmin's home
// org — the same org that bears the generation cost.
//
// Unlike Writing, Speaking moderation is approve/reject only — no inline
// content edit. Speaking content is a structured 3-part object, not a single
// prose block; bad content is rejected and regenerated (ADR 0006 D4).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, withSuperAdminContext } from "@elc/db";
import { requireRole } from "@/lib/auth/context";

function readTestId(formData: FormData): string {
  const testId = formData.get("testId");
  if (typeof testId !== "string" || testId.length === 0) {
    throw new Error("Missing testId.");
  }
  return testId;
}

async function loadSpeakingTest(testId: string): Promise<{
  id: string;
  status: "Draft" | "PendingReview" | "Approved" | "Rejected";
  section: "Reading" | "Listening" | "Writing" | "Speaking";
} | null> {
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);
  return db.test.findUnique({
    where: { id: testId },
    select: { id: true, status: true, section: true },
  });
}

export async function approveSpeakingTest(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = readTestId(formData);
  const db = withSuperAdminContext(ctx);

  const test = await loadSpeakingTest(testId);
  if (!test) throw new Error("Test not found.");
  if (test.section !== "Speaking") {
    throw new Error("Only Speaking tests can be moderated here.");
  }
  if (test.status !== "PendingReview") {
    if (test.status === "Approved") {
      redirect(`/content/speaking/${testId}?approved=1`);
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
      action: "content.speaking.approved",
      metadata: { test_id: test.id } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/content/speaking");
  redirect("/content/speaking?approved=" + test.id);
}

export async function rejectSpeakingTest(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = readTestId(formData);
  const reasonRaw = formData.get("reason");
  const reason =
    typeof reasonRaw === "string" && reasonRaw.trim().length > 0
      ? reasonRaw.trim().slice(0, 500)
      : undefined;

  const db = withSuperAdminContext(ctx);
  const test = await loadSpeakingTest(testId);
  if (!test) throw new Error("Test not found.");
  if (test.section !== "Speaking") {
    throw new Error("Only Speaking tests can be moderated here.");
  }
  if (test.status !== "PendingReview") {
    if (test.status === "Rejected") {
      redirect(`/content/speaking?rejected=${testId}`);
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
      action: "content.speaking.rejected",
      metadata: {
        test_id: test.id,
        reason: reason ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/content/speaking");
  redirect("/content/speaking?rejected=" + test.id);
}
