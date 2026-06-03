"use server";

// SuperAdmin-only lifecycle actions for ALREADY-APPROVED content, shared
// across all four sections (Reading / Listening / Writing / Speaking).
//
// The per-section `moderation-actions.ts` files own the PendingReview →
// Approved/Rejected transitions (each runs its own contract guards / synth).
// This module owns what happens to a test AFTER it has gone live:
//
//   • retireApprovedTest  — Approved → Rejected. Pulls the test back out of
//     the learner pool (pickers read `status: "Approved"`). We reuse the
//     existing `Rejected` enum value (no migration — see the plan's P1), so
//     the distinct `content.{section}.retired` ActivityLog action is the
//     only thing separating "failed initial review" from "was live, pulled".
//   • reopenApprovedTest  — Approved → PendingReview. Sends a live test back
//     through review so its content can be edited (Writing edits in place;
//     the others regenerate/replace) and re-approved under the guards.
//   • deleteApprovedTest  — hard delete, GUARDED. Only permitted when the
//     test has ZERO Attempt rows; otherwise it is refused. `Attempt.test`
//     is `onDelete: Cascade` all the way down to Answer/Grade/Recording, so
//     deleting an attempted test would silently destroy learner history
//     across every org.
//
// Test/Question are global models, so we use withSuperAdminContext() — never
// withOrg(), never both in one function. The attempt-count guard is the one
// tenant-scoped read here: it MUST run cross-org (a global test can carry
// attempts from any org), which is exactly what withSuperAdminContext() gives
// us. Using withOrg() would scope the count to the SuperAdmin's own org and
// could green-light a delete that wipes another org's data.
//
// ActivityLog rows are tenant-scoped, so super-level events land under the
// singleton SYSTEM_ORG_ID; OrgAdmin views never see them.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  Prisma,
  SYSTEM_ORG_ID,
  planDelete,
  planReopen,
  planRetire,
  withSuperAdminContext,
} from "@elc/db";
import { requireRole } from "@/lib/auth/context";

type Section = "Reading" | "Listening" | "Writing" | "Speaking";

const SECTION_PATHS: Record<Section, string> = {
  Reading: "reading",
  Listening: "listening",
  Writing: "writing",
  Speaking: "speaking",
};

function isSection(raw: unknown): raw is Section {
  return (
    raw === "Reading" ||
    raw === "Listening" ||
    raw === "Writing" ||
    raw === "Speaking"
  );
}

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

function readSection(formData: FormData): Section {
  const raw = formData.get("section");
  if (!isSection(raw)) {
    throw new Error("Missing or invalid section.");
  }
  return raw;
}

export async function retireApprovedTest(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = readField(formData, "testId");
  const section = readSection(formData);
  const path = SECTION_PATHS[section];
  const db = withSuperAdminContext(ctx);

  const test = await db.test.findUnique({
    where: { id: testId },
    select: { id: true, status: true, section: true },
  });
  if (!test) throw new Error("Test not found.");
  if (test.section !== section) {
    throw new Error(`Test ${testId} is not a ${section} test.`);
  }

  const decision = planRetire(test.status);
  if (decision.kind === "idempotent") {
    redirect(`/content/${path}/${testId}?retired=1`);
  }
  if (decision.kind === "invalid") {
    throw new Error(`Cannot retire a ${decision.currentStatus} test.`);
  }

  await db.test.update({
    where: { id: test.id },
    data: { status: decision.nextStatus },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: `content.${path}.retired`,
      metadata: { test_id: test.id } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/content");
  revalidatePath(`/content/${path}`);
  revalidatePath(`/content/${path}/${testId}`);
  redirect(`/content/${path}/${testId}?retired=1`);
}

export async function reopenApprovedTest(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = readField(formData, "testId");
  const section = readSection(formData);
  const path = SECTION_PATHS[section];
  const db = withSuperAdminContext(ctx);

  const test = await db.test.findUnique({
    where: { id: testId },
    select: { id: true, status: true, section: true },
  });
  if (!test) throw new Error("Test not found.");
  if (test.section !== section) {
    throw new Error(`Test ${testId} is not a ${section} test.`);
  }

  const decision = planReopen(test.status);
  if (decision.kind === "idempotent") {
    redirect(`/content/${path}/${testId}?reopened=1`);
  }
  if (decision.kind === "invalid") {
    throw new Error(`Cannot reopen a ${decision.currentStatus} test.`);
  }

  // Clear approved_by so the row reads cleanly as un-approved while it sits
  // back in the queue; the next approval restamps it.
  await db.test.update({
    where: { id: test.id },
    data: { status: decision.nextStatus, approved_by: null },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: `content.${path}.reopened`,
      metadata: { test_id: test.id } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/content");
  revalidatePath(`/content/${path}`);
  revalidatePath(`/content/${path}/${testId}`);
  redirect(`/content/${path}/${testId}?reopened=1`);
}

export async function deleteApprovedTest(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const testId = readField(formData, "testId");
  const section = readSection(formData);
  const path = SECTION_PATHS[section];
  const db = withSuperAdminContext(ctx);

  const test = await db.test.findUnique({
    where: { id: testId },
    select: { id: true, section: true },
  });
  if (!test) throw new Error("Test not found.");
  if (test.section !== section) {
    throw new Error(`Test ${testId} is not a ${section} test.`);
  }

  // HARD GUARD: a test with any learner attempt must never be deleted —
  // Attempt.test cascades to Answer/Grade/Recording. Count cross-org via the
  // SuperAdmin client (a global test can carry attempts from any org).
  const attemptCount = await db.attempt.count({ where: { test_id: testId } });
  const decision = planDelete(attemptCount);
  if (decision.kind === "blocked") {
    redirect(
      `/content/${path}/${testId}?delete_blocked=${decision.reason}&attempts=${decision.attemptCount}`,
    );
  }

  // Question rows cascade with the Test (onDelete: Cascade). No Attempts
  // exist, so nothing downstream is destroyed.
  await db.test.delete({ where: { id: testId } });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: `content.${path}.deleted`,
      metadata: { test_id: testId, section } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/content");
  revalidatePath(`/content/${path}`);
  redirect(`/content/${path}?deleted=${testId}`);
}
