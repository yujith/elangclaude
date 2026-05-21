"use server";

// SuperAdmin-only moderation actions for Writing tests.
//
// Test/Question are global models — withOrg() would pass them through
// unscoped anyway — so we use withSuperAdminContext() per the multi-
// tenancy rule. NEVER mix the two helpers in the same function.
//
// ActivityLog rows are tenant-scoped, so we park super-level events under
// the singleton SYSTEM_ORG_ID. OrgAdmin views never see these because
// withOrg() filters by the caller's org_id.
//
// `editWritingPrompt` is the one thing Writing moderation has that
// Reading doesn't: Writing tasks are wordy enough that a reviewer will
// often want to tweak the prompt text before approving. We mutate the
// row in place and record the original text in ActivityLog so the edit
// is auditable.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, SYSTEM_ORG_ID, withSuperAdminContext } from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import {
  serializeWritingIssueCodes,
  validateWritingReviewRecord,
} from "@/lib/writing/review-validation";

type SuperAdminDb = ReturnType<typeof withSuperAdminContext>;

type WritingModerationRecord = {
  id: string;
  track: "Academic" | "GeneralTraining";
  difficulty: number;
  status: "Draft" | "PendingReview" | "Approved" | "Rejected";
  section: "Reading" | "Listening" | "Writing" | "Speaking";
  body_json: unknown;
  questions: {
    id: string;
    type: string;
    prompt: string;
    visual: unknown;
  }[];
};

async function loadWritingTest(
  db: SuperAdminDb,
  testId: string,
): Promise<WritingModerationRecord | null> {
  return db.test.findUnique({
    where: { id: testId },
    select: {
      id: true,
      track: true,
      difficulty: true,
      status: true,
      section: true,
      body_json: true,
      questions: {
        select: { id: true, type: true, prompt: true, visual: true },
        orderBy: { position: "asc" },
        take: 1,
      },
    },
  });
}

function readTestId(formData: FormData): string {
  const testId = formData.get("testId");
  if (typeof testId !== "string" || testId.length === 0) {
    throw new Error("Missing testId.");
  }
  return testId;
}

function redirectWithValidationFailure(
  path: string,
  paramName: "approve_error" | "edit_error",
  result: Extract<ReturnType<typeof validateWritingReviewRecord>, { ok: false }>,
): never {
  const params = new URLSearchParams({ [paramName]: result.reason });
  const issueCodes = serializeWritingIssueCodes(result.issueCodes);
  if (issueCodes.length > 0) {
    params.set("validation_issues", issueCodes);
  }
  redirect(`${path}?${params.toString()}`);
}

export async function approveWritingTest(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = readTestId(formData);
  const db = withSuperAdminContext(ctx);

  const test = await loadWritingTest(db, testId);
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
  const question = test.questions[0];
  if (!question) {
    redirectWithValidationFailure(`/content/writing/${testId}`, "approve_error", {
      ok: false,
      reason: "schema",
      issueCodes: ["schema.invalid-generated-writing"],
    });
  }

  const validation = validateWritingReviewRecord({
    track: test.track,
    difficulty: test.difficulty,
    body_json: test.body_json,
    question,
  });
  if (!validation.ok) {
    redirectWithValidationFailure(
      `/content/writing/${testId}`,
      "approve_error",
      validation,
    );
  }

  await db.test.update({
    where: { id: test.id },
    data: { status: "Approved", approved_by: ctx.user_id },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
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
  const test = await loadWritingTest(db, testId);
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
      org_id: SYSTEM_ORG_ID,
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
  const test = await loadWritingTest(db, testId);
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

  const validation = validateWritingReviewRecord({
    track: test.track,
    difficulty: test.difficulty,
    body_json: test.body_json,
    question: {
      ...question,
      prompt: nextPrompt,
    },
  });
  if (!validation.ok) {
    redirectWithValidationFailure(
      `/content/writing/${testId}`,
      "edit_error",
      validation,
    );
  }

  await db.question.update({
    where: { id: question.id },
    data: { prompt: nextPrompt },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
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
