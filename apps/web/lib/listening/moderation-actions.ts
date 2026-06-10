"use server";

// SuperAdmin-only moderation actions for Listening tests.
//
// Test/Question are global models — withOrg() would pass them through
// unscoped anyway — so we use withSuperAdminContext() per the multi-
// tenancy rule. NEVER mix the two helpers in the same function.
//
// Approve runs TTS synth for every speech / narration segment in line
// with the action — it is a synchronous orchestration that can take
// 20–40 seconds for a freshly-generated section. A failed synth on
// one segment does NOT roll the approval back; the test ships with the
// successful clips and the SuperAdmin can re-synthesise from the
// review page.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, SYSTEM_ORG_ID, withSuperAdminContext } from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import { synthesiseListeningClips } from "@/lib/listening/synth";

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

  // Flip status FIRST. If the synth run partially fails the test is
  // still approved (with missing clips) — the alternative ("roll back
  // approval on any synth failure") leaves the SuperAdmin stuck in a
  // loop where one flaky clip blocks the whole release.
  await db.test.update({
    where: { id: test.id },
    data: { status: "Approved", approved_by: ctx.user_id },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "content.listening.approved",
      metadata: { test_id: test.id } as Prisma.InputJsonValue,
    },
  });

  const synth = await synthesiseListeningClips(ctx, testId);

  revalidatePath("/content/listening");
  revalidatePath(`/content/listening/${testId}`);
  if (synth.failures > 0) {
    // Drop the SuperAdmin on the review page, not back at the queue —
    // the queue page lists pending tests only, so a partial-fail approve
    // used to dead-end with no way to reach the re-synth form. The review
    // page hosts the form and now renders the same hint banner.
    const hint = synth.errorSamples.join(" || ");
    const hintParam = hint
      ? `&synth_hint=${encodeURIComponent(hint)}`
      : "";
    redirect(
      `/content/listening/${test.id}?approved=1&synth_error=${synth.failures}-of-${synth.attempted}-failed${hintParam}`,
    );
  }
  redirect("/content/listening?approved=" + test.id);
}

// Re-runs TTS synth without changing approval status. Used by the
// review page's "Re-synthesise audio" form when an earlier approve
// partially failed.
export async function resynthesiseListeningAudio(
  formData: FormData,
): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = formData.get("testId");
  if (typeof testId !== "string" || testId.length === 0) {
    throw new Error("Missing testId.");
  }
  const synth = await synthesiseListeningClips(ctx, testId);
  revalidatePath(`/content/listening/${testId}`);
  if (synth.failures > 0) {
    const hint = synth.errorSamples.join(" || ");
    const hintParam = hint
      ? `&synth_hint=${encodeURIComponent(hint)}`
      : "";
    redirect(
      `/content/listening/${testId}?synth_error=${synth.failures}-of-${synth.attempted}-failed${hintParam}`,
    );
  }
  redirect(`/content/listening/${testId}?synth_ok=${synth.synthed}-of-${synth.attempted}`);
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
      org_id: SYSTEM_ORG_ID,
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

// TTS orchestration lives in lib/listening/synth.ts (shared with the
// ADR-0024 automation publish gate).
