"use server";

// SuperAdmin-only actions for the full Reading paper (3 passages, one
// sitting).
//
// ReadingPaper / ReadingPaperPart are GLOBAL content (same class as Test):
// we use withSuperAdminContext() per the multi-tenancy rule and NEVER mix
// it with withOrg(). Super-level ActivityLog rows park under SYSTEM_ORG_ID.
//
// Two creation paths:
//   1. Curate — bundle three already-Approved passage-Tests into an
//      Approved paper immediately (the parts are already vetted).
//   2. Generate — run the existing single-passage generator three times
//      (ascending difficulty), landing 3 PendingReview Tests + a Draft
//      paper. The paper can be Approved once all three parts are Approved.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, SYSTEM_ORG_ID, withSuperAdminContext } from "@elc/db";
import { requireRole } from "@/lib/auth/context";
import {
  READING_PAPER_SLOTS,
  validateCuration,
  type CandidatePart,
  type ReadingPaperSlot,
} from "@elc/ai";
import { generateReadingTest } from "@/lib/reading/generate-actions";

type Track = "Academic" | "GeneralTraining";

function parseTrack(raw: unknown): Track | null {
  return raw === "Academic" || raw === "GeneralTraining" ? raw : null;
}

function readTitle(formData: FormData): string | undefined {
  const raw = formData.get("title");
  return typeof raw === "string" && raw.trim().length > 0
    ? raw.trim().slice(0, 200)
    : undefined;
}

// ─── Curate from approved parts ───────────────────────────────────────────

export type CurateOutcome =
  | { ok: true; paperId: string }
  | { ok: false; error: "bad_request" | "invalid_parts"; issues?: string[] };

export async function curateReadingPaper(input: {
  track: Track;
  title?: string;
  // testId per slot, in slot order [slot1, slot2, slot3].
  testIds: [string, string, string];
}): Promise<CurateOutcome> {
  const ctx = await requireRole("SuperAdmin");
  const db = withSuperAdminContext(ctx);

  const slotTestIds = input.testIds;
  if (slotTestIds.some((id) => typeof id !== "string" || id.length === 0)) {
    return { ok: false, error: "bad_request" };
  }

  // Hydrate the candidate parts from the DB — never trust client-provided
  // track/status. The Test ids are global, so a SuperAdmin read is correct.
  const tests = await db.test.findMany({
    where: { id: { in: slotTestIds } },
    select: { id: true, track: true, section: true, status: true },
  });
  const byId = new Map(tests.map((t) => [t.id, t]));

  const candidates: CandidatePart[] = [];
  READING_PAPER_SLOTS.forEach((slot, idx) => {
    const t = byId.get(slotTestIds[idx]!);
    if (!t) return; // surfaces as a missing-slot issue below
    candidates.push({
      slot,
      testId: t.id,
      track: t.track,
      section: t.section,
      status: t.status,
    });
  });

  const issues = validateCuration(input.track, candidates);
  if (issues.length > 0) {
    return {
      ok: false,
      error: "invalid_parts",
      issues: issues.map((i) => i.code),
    };
  }

  const paper = await db.readingPaper.create({
    data: {
      track: input.track,
      title: input.title ?? null,
      // Curated from already-Approved parts → releasable immediately.
      status: "Approved",
      approved_by: ctx.user_id,
      parts: {
        create: candidates.map((c) => ({ slot: c.slot, test_id: c.testId })),
      },
    },
    select: { id: true },
  });

  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "content.reading_paper.curated",
      metadata: {
        paper_id: paper.id,
        test_ids: slotTestIds,
      } as Prisma.InputJsonValue,
    },
  });

  return { ok: true, paperId: paper.id };
}

export async function curateReadingPaperForm(formData: FormData): Promise<void> {
  const track = parseTrack(formData.get("track"));
  if (!track) throw new Error("Missing or invalid track.");
  const testIds = READING_PAPER_SLOTS.map((slot) => {
    const raw = formData.get(`slot${slot}`);
    return typeof raw === "string" ? raw : "";
  }) as [string, string, string];

  const outcome = await curateReadingPaper({
    track,
    title: readTitle(formData),
    testIds,
  });

  if (!outcome.ok) {
    const params = new URLSearchParams({ paper_error: outcome.error });
    if (outcome.issues && outcome.issues.length > 0) {
      params.set("paper_issues", [...new Set(outcome.issues)].join(","));
    }
    redirect(`/content/reading/papers?${params.toString()}`);
  }
  revalidatePath("/content/reading/papers");
  redirect(`/content/reading/papers?curated=${outcome.paperId}`);
}

// ─── Generate a fresh 3-part paper ────────────────────────────────────────

// Ascending difficulty across the three passages, mirroring the real exam.
const PAPER_DIFFICULTY: Record<ReadingPaperSlot, number> = { 1: 2, 2: 3, 3: 4 };

export async function generateReadingPaperForm(
  formData: FormData,
): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const track = parseTrack(formData.get("track"));
  if (!track) throw new Error("Missing or invalid track.");

  const createdTestIds: string[] = [];
  for (const slot of READING_PAPER_SLOTS) {
    const outcome = await generateReadingTest({
      track,
      difficulty: PAPER_DIFFICULTY[slot],
      // Academic stamps the part; GT derives it from gt_context.
      part: track === "Academic" ? slot : undefined,
    });
    if (!outcome.ok) {
      // Partial failure: keep whatever parts generated as standalone
      // PendingReview passages (they're still useful), and report the slot.
      const params = new URLSearchParams({
        paper_error: "generate_failed",
        failed_slot: String(slot),
        generate_error: outcome.error,
      });
      redirect(`/content/reading/papers?${params.toString()}`);
    }
    createdTestIds.push(outcome.testId);
  }

  const db = withSuperAdminContext(ctx);
  const paper = await db.readingPaper.create({
    data: {
      track,
      title: readTitle(formData) ?? null,
      // Parts are PendingReview until moderated — paper starts Draft and is
      // approved later via approveReadingPaper once every part is Approved.
      status: "Draft",
      parts: {
        create: READING_PAPER_SLOTS.map((slot, idx) => ({
          slot,
          test_id: createdTestIds[idx]!,
        })),
      },
    },
    select: { id: true },
  });

  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "content.reading_paper.generated",
      metadata: {
        paper_id: paper.id,
        test_ids: createdTestIds,
      } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/content/reading/papers");
  revalidatePath("/content/reading");
  redirect(`/content/reading/papers?generated=${paper.id}`);
}

// ─── Approve a Draft paper ────────────────────────────────────────────────

export async function approveReadingPaper(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const paperId = formData.get("paperId");
  if (typeof paperId !== "string" || paperId.length === 0) {
    throw new Error("Missing paperId.");
  }
  const db = withSuperAdminContext(ctx);
  const paper = await db.readingPaper.findUnique({
    where: { id: paperId },
    select: {
      id: true,
      track: true,
      status: true,
      parts: {
        select: {
          slot: true,
          test: { select: { id: true, track: true, section: true, status: true } },
        },
      },
    },
  });
  if (!paper) throw new Error("Paper not found.");
  if (paper.status === "Approved") {
    redirect(`/content/reading/papers?approved=${paperId}`);
  }

  const candidates: CandidatePart[] = paper.parts.map((p) => ({
    slot: p.slot as ReadingPaperSlot,
    testId: p.test.id,
    track: p.test.track,
    section: p.test.section,
    status: p.test.status,
  }));
  const issues = validateCuration(paper.track, candidates);
  if (issues.length > 0) {
    const params = new URLSearchParams({
      paper_error: "incomplete",
      paper_issues: [...new Set(issues.map((i) => i.code))].join(","),
    });
    redirect(`/content/reading/papers?${params.toString()}`);
  }

  await db.readingPaper.update({
    where: { id: paper.id },
    data: { status: "Approved", approved_by: ctx.user_id },
  });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "content.reading_paper.approved",
      metadata: { paper_id: paper.id } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/content/reading/papers");
  redirect(`/content/reading/papers?approved=${paper.id}`);
}

// ─── Delete a paper (the bundle only; parts survive) ──────────────────────

export async function deleteReadingPaper(formData: FormData): Promise<void> {
  const ctx = await requireRole("SuperAdmin");
  const paperId = formData.get("paperId");
  if (typeof paperId !== "string" || paperId.length === 0) {
    throw new Error("Missing paperId.");
  }
  const db = withSuperAdminContext(ctx);
  const paper = await db.readingPaper.findUnique({
    where: { id: paperId },
    select: { id: true, _count: { select: { sittings: true } } },
  });
  if (!paper) throw new Error("Paper not found.");

  // Deletion is always allowed — unlike a Test (whose delete cascades to
  // Answer/Grade and is therefore guarded), deleting a ReadingPaper only
  // cascades the ReadingPaperPart join rows and the sitting *wrappers*
  // (ReadingPaperSession). Each sitting's part Attempts survive: their
  // reading_paper_session_id is set null (onDelete: SetNull), so learner
  // work and grades are preserved as standalone reading attempts. The
  // underlying passage-Tests are untouched (they may be in other papers or
  // used for standalone practice). The confirm dialog warns when sittings
  // exist; the sitting count is recorded on the ActivityLog for audit.
  await db.readingPaper.delete({ where: { id: paper.id } });
  await db.activityLog.create({
    data: {
      org_id: SYSTEM_ORG_ID,
      user_id: ctx.user_id,
      action: "content.reading_paper.deleted",
      metadata: {
        paper_id: paperId,
        sittings_detached: paper._count.sittings,
      } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/content/reading/papers");
  redirect(`/content/reading/papers?deleted=${paperId}`);
}
