"use server";

// SuperAdmin-only moderation actions for Writing tests.
//
// Test/Question are global models — withOrg() would pass them through
// unscoped anyway — so we use withSuperAdminContext() per the multi-
// tenancy rule. NEVER mix the two helpers in the same function.
//
// ActivityLog rows are tenant-scoped, so we log under the SuperAdmin's
// home org — the same org that bears the generation cost.
//
// `editWritingPrompt` is the one thing Writing moderation has that
// Reading doesn't: Writing tasks are wordy enough that a reviewer will
// often want to tweak the prompt text before approving. We mutate the
// row in place and record the original text in ActivityLog so the edit
// is auditable.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, withSuperAdminContext } from "@elc/db";
import { requireRole } from "@/lib/auth/context";

async function loadWritingTest(testId: string): Promise<{
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

function readTestId(formData: FormData): string {
  const testId = formData.get("testId");
  if (typeof testId !== "string" || testId.length === 0) {
    throw new Error("Missing testId.");
  }
  return testId;
}

export async function approveWritingTest(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = readTestId(formData);
  const db = withSuperAdminContext(ctx);

  const test = await loadWritingTest(testId);
  if (!test) throw new Error("Test not found.");
  if (test.section !== "Writing") {
    throw new Error("Only Writing tests can be moderated here.");
  }
  if (test.status !== "PendingReview") {
    if (test.status === "Approved") {
      redirect(`/content/writing/${testId}?approved=1`);
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
      action: "content.writing.approved",
      metadata: { test_id: test.id } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/content/writing");
  redirect("/content/writing?approved=" + test.id);
}

export async function rejectWritingTest(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = readTestId(formData);
  const reasonRaw = formData.get("reason");
  const reason =
    typeof reasonRaw === "string" && reasonRaw.trim().length > 0
      ? reasonRaw.trim().slice(0, 500)
      : undefined;

  const db = withSuperAdminContext(ctx);
  const test = await loadWritingTest(testId);
  if (!test) throw new Error("Test not found.");
  if (test.section !== "Writing") {
    throw new Error("Only Writing tests can be moderated here.");
  }
  if (test.status !== "PendingReview") {
    if (test.status === "Rejected") {
      redirect(`/content/writing?rejected=${testId}`);
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
      action: "content.writing.rejected",
      metadata: {
        test_id: test.id,
        reason: reason ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/content/writing");
  redirect("/content/writing?rejected=" + test.id);
}

// Edit the task prompt in place before approving. Only allowed while the
// test is still PendingReview — once it's Approved or Rejected the text
// is frozen. The original is recorded in ActivityLog metadata.
export async function editWritingPrompt(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = readTestId(formData);
  const promptRaw = formData.get("prompt");
  if (typeof promptRaw !== "string") {
    throw new Error("Missing prompt.");
  }
  const nextPrompt = promptRaw.trim();
  if (nextPrompt.length < 20 || nextPrompt.length > 2400) {
    redirect(`/content/writing/${testId}?edit_error=length`);
  }

  const db = withSuperAdminContext(ctx);
  const test = await db.test.findUnique({
    where: { id: testId },
    select: {
      id: true,
      status: true,
      section: true,
      questions: {
        select: { id: true, prompt: true },
        orderBy: { position: "asc" },
        take: 1,
      },
    },
  });
  if (!test) throw new Error("Test not found.");
  if (test.section !== "Writing") {
    throw new Error("Only Writing tests can be edited here.");
  }
  if (test.status !== "PendingReview") {
    throw new Error(`Cannot edit a ${test.status} test.`);
  }
  const question = test.questions[0];
  if (!question) throw new Error("Writing test has no task question.");
  if (question.prompt === nextPrompt) {
    // No-op edit — skip the write and the log line.
    redirect(`/content/writing/${testId}`);
  }

  await db.question.update({
    where: { id: question.id },
    data: { prompt: nextPrompt },
  });
  await db.activityLog.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      action: "content.writing.prompt_edited",
      metadata: {
        test_id: test.id,
        question_id: question.id,
        original_prompt: question.prompt,
      } as Prisma.InputJsonValue,
    },
  });

  revalidatePath(`/content/writing/${testId}`);
  redirect(`/content/writing/${testId}?edited=1`);
}
