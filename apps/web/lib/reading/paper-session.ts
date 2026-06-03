"use server";

// Orchestrator for a full Reading paper sitting (3 passages, one sitting).
//
// Mirrors apps/web/lib/mock/actions.ts but stays inside Reading: a
// ReadingPaperSession parents three part Attempts (one per slot), each
// against the paper's slot Test. Progression is forward-only and derived
// server-side from the joined Attempt rows, exactly like the mock.
//
// Every read/write goes through withOrg(ctx). ReadingPaper /
// ReadingPaperPart are global content and pass through unscoped; the
// session + attempts are tenant-scoped and auto-filtered by org_id.

import { redirect } from "next/navigation";
import { withOrg } from "@elc/db";
import type { OrgContext } from "@elc/db";
import { READING_PAPER_SLOTS, type ReadingPaperSlot } from "@elc/ai";
import { requireOrgContext } from "@/lib/auth/context";

export type PaperPartState = {
  slot: ReadingPaperSlot;
  testId: string;
  title: string | null;
  state: "not-started" | "in-progress" | "graded";
  attemptId: string | null;
};

export type PaperSessionState =
  | { ok: false; error: "not-found" }
  | {
      ok: true;
      sessionId: string;
      track: "Academic" | "GeneralTraining";
      status: "InProgress" | "Submitted" | "Abandoned";
      parts: PaperPartState[];
      // First not-graded part, or null when every part is graded.
      currentSlot: ReadingPaperSlot | null;
      allGraded: boolean;
    };

// Reads the live state of a paper sitting from its joined Attempt rows.
export async function readPaperSessionState(
  ctx: OrgContext,
  sessionId: string,
): Promise<PaperSessionState> {
  const db = withOrg(ctx);
  const session = await db.readingPaperSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      user_id: true,
      track: true,
      status: true,
      paper: {
        select: {
          parts: {
            orderBy: { slot: "asc" },
            select: {
              slot: true,
              test: {
                select: { id: true, body_json: true },
              },
            },
          },
        },
      },
      attempts: {
        select: { id: true, test_id: true, status: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!session || session.user_id !== ctx.user_id) {
    return { ok: false, error: "not-found" };
  }

  // Index the latest attempt per test_id. validateCuration forbids a
  // passage appearing in two slots, so test_id uniquely maps to a slot.
  const byTest = new Map<string, { id: string; status: string }>();
  for (const a of session.attempts) {
    if (!byTest.has(a.test_id)) byTest.set(a.test_id, { id: a.id, status: a.status });
  }

  const parts: PaperPartState[] = session.paper.parts.map((p) => {
    const a = byTest.get(p.test.id);
    const title = passageTitle(p.test.body_json);
    if (!a) {
      return { slot: p.slot as ReadingPaperSlot, testId: p.test.id, title, state: "not-started", attemptId: null };
    }
    if (a.status === "Graded" || a.status === "Submitted") {
      return { slot: p.slot as ReadingPaperSlot, testId: p.test.id, title, state: "graded", attemptId: a.id };
    }
    return { slot: p.slot as ReadingPaperSlot, testId: p.test.id, title, state: "in-progress", attemptId: a.id };
  });

  const current = parts.find((p) => p.state !== "graded") ?? null;
  const allGraded = parts.length > 0 && parts.every((p) => p.state === "graded");

  return {
    ok: true,
    sessionId: session.id,
    track: session.track,
    status: session.status,
    parts,
    currentSlot: current ? current.slot : null,
    allGraded,
  };
}

function passageTitle(bodyJson: unknown): string | null {
  if (bodyJson && typeof bodyJson === "object" && "title" in bodyJson) {
    const t = (bodyJson as { title?: unknown }).title;
    return typeof t === "string" ? t : null;
  }
  return null;
}

// ─── Start a paper sitting ────────────────────────────────────────────────

export async function startReadingPaper(formData: FormData): Promise<void> {
  const ctx = await requireOrgContext();
  const paperId = formData.get("paperId");
  if (typeof paperId !== "string" || paperId.length === 0) {
    throw new Error("Missing paperId.");
  }
  const db = withOrg(ctx);

  const me = await db.user.findUniqueOrThrow({
    where: { id: ctx.user_id },
    select: { ielts_track: true },
  });

  // ReadingPaper is global — withOrg passes it through. Require it Approved
  // and matching the learner's track before creating a sitting.
  const paper = await db.readingPaper.findUnique({
    where: { id: paperId },
    select: { id: true, track: true, status: true },
  });
  if (!paper || paper.status !== "Approved" || paper.track !== me.ielts_track) {
    throw new Error("Paper is not available.");
  }

  // Resume an existing in-progress sitting for this paper rather than
  // spawning duplicates.
  const existing = await db.readingPaperSession.findFirst({
    where: { user_id: ctx.user_id, paper_id: paper.id, status: "InProgress" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    redirect(`/practice/reading/paper/${existing.id}`);
  }

  const session = await db.readingPaperSession.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      paper_id: paper.id,
      track: paper.track,
      status: "InProgress",
    },
    select: { id: true },
  });
  redirect(`/practice/reading/paper/${session.id}`);
}

// ─── Start / resume a part ────────────────────────────────────────────────

// Ensures an Attempt exists for (session, slot) and routes to the runner.
// Creates one against the slot's Test with reading_paper_session_id set.
export async function startReadingPaperPart(formData: FormData): Promise<void> {
  const ctx = await requireOrgContext();
  const sessionId = formData.get("sessionId");
  const slotRaw = formData.get("slot");
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("Missing sessionId.");
  }
  const slot = parseSlot(slotRaw);
  if (slot === null) throw new Error("Invalid slot.");

  const attemptId = await ensurePaperPartAttempt(ctx, sessionId, slot);
  if (!attemptId) {
    redirect(`/practice/reading/paper/${sessionId}`);
  }
  redirect(`/practice/reading/${attemptId}`);
}

async function ensurePaperPartAttempt(
  ctx: OrgContext,
  sessionId: string,
  slot: ReadingPaperSlot,
): Promise<string | null> {
  const db = withOrg(ctx);
  const session = await db.readingPaperSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      user_id: true,
      status: true,
      paper: {
        select: {
          parts: {
            where: { slot },
            select: { test: { select: { id: true, status: true, section: true } } },
          },
        },
      },
      attempts: {
        select: { id: true, test_id: true, status: true },
      },
    },
  });
  if (!session || session.user_id !== ctx.user_id) return null;
  const part = session.paper.parts[0];
  if (!part || part.test.section !== "Reading" || part.test.status !== "Approved") {
    return null;
  }

  // Reuse a live attempt for this slot's test if one exists.
  const existing = session.attempts.find(
    (a) => a.test_id === part.test.id && a.status === "InProgress",
  );
  if (existing) return existing.id;
  const graded = session.attempts.find(
    (a) =>
      a.test_id === part.test.id &&
      (a.status === "Graded" || a.status === "Submitted"),
  );
  if (graded) return graded.id; // already done — runner will bounce to results/orchestrator

  const attempt = await db.attempt.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      test_id: part.test.id,
      section: "Reading",
      status: "InProgress",
      reading_paper_session_id: session.id,
    },
    select: { id: true },
  });
  return attempt.id;
}

// Flip a fully-graded sitting to Submitted. Idempotent; called by the
// result page once every part is graded.
export async function finalizePaperSession(
  ctx: OrgContext,
  sessionId: string,
): Promise<void> {
  const db = withOrg(ctx);
  const session = await db.readingPaperSession.findUnique({
    where: { id: sessionId },
    select: { id: true, user_id: true, status: true },
  });
  if (!session || session.user_id !== ctx.user_id) return;
  if (session.status !== "InProgress") return;
  await db.readingPaperSession.update({
    where: { id: session.id },
    data: { status: "Submitted", submitted_at: new Date() },
  });
}

function parseSlot(raw: unknown): ReadingPaperSlot | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return READING_PAPER_SLOTS.includes(n as ReadingPaperSlot)
    ? (n as ReadingPaperSlot)
    : null;
}
