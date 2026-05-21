"use server";

// SuperAdmin-only moderation actions for Speaking tests.
//
// Test/Question are global models — withOrg() would pass them through
// unscoped anyway — so we use withSuperAdminContext() per the multi-tenancy
// rule. NEVER mix the two helpers in the same function.
//
// ActivityLog rows are tenant-scoped, so we park super-level events under
// the singleton SYSTEM_ORG_ID. OrgAdmin views never see these because
// withOrg() filters by the caller's org_id.
//
// Unlike Writing, Speaking moderation is approve/reject only — no inline
// content edit. Speaking content is a structured 3-part object, not a single
// prose block; bad content is rejected and regenerated (ADR 0006 D4).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, SYSTEM_ORG_ID, withSuperAdminContext } from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import {
  serializeSpeakingIssueCodes,
  validateSpeakingReviewRecord,
} from "@/lib/speaking/review-validation";

function readTestId(formData: FormData): string {
  const testId = formData.get("testId");
  if (typeof testId !== "string" || testId.length === 0) {
    throw new Error("Missing testId.");
  }
  return testId;
}

type SuperAdminDb = ReturnType<typeof withSuperAdminContext>;

type SpeakingModerationRecord = {
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
    position: number;
  }[];
};

async function loadSpeakingTest(
  db: SuperAdminDb,
  testId: string,
): Promise<SpeakingModerationRecord | null> {
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
        select: {
          id: true,
          type: true,
          prompt: true,
          position: true,
        },
        orderBy: { position: "asc" },
      },
    },
  });
}

function redirectWithValidationFailure(
  path: string,
  result: Extract<ReturnType<typeof validateSpeakingReviewRecord>, { ok: false }>,
): never {
  const params = new URLSearchParams({ approve_error: result.reason });
  const issueCodes = serializeSpeakingIssueCodes(result.issueCodes);
  if (issueCodes.length > 0) {
    params.set("validation_issues", issueCodes);
  }
  redirect(`${path}?${params.toString()}`);
}

export async function approveSpeakingTest(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = readTestId(formData);
  const db = withSuperAdminContext(ctx);

  const test = await loadSpeakingTest(db, testId);
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

  const validation = validateSpeakingReviewRecord({
    track: test.track,
    difficulty: test.difficulty,
    body_json: test.body_json,
    questions: test.questions,
  });
  if (!validation.ok) {
    redirectWithValidationFailure(`/content/speaking/${testId}`, validation);
  }

  await db.test.update({
    where: { id: test.id },
    data: { status: "Approved", approved_by: ctx.user_id },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
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
  const test = await loadSpeakingTest(db, testId);
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
      org_id: SYSTEM_ORG_ID,
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
