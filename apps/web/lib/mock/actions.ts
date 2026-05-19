"use server";

// Server actions + lifecycle helpers for Full Mock Test sessions.
//
// A mock is one MockSession row + four (optional) child Attempts, one
// per section, in the order Listening → Reading → Writing → Speaking
// (ADR 0008 D4). The orchestrator route reads `currentMockState()` and
// either redirects to the next section's runner or flips the session
// to Submitted and shows the aggregate result.
//
// Test/Question are global models. MockSession + Attempt are tenant-
// scoped and accessed via withOrg(ctx) — never the SuperAdmin proxy.

import { redirect } from "next/navigation";
import {
  Prisma,
  type Section,
  type Track,
  withOrg,
} from "@elc/db";
import type { OrgContext } from "@elc/db";
import { requireOrgContext } from "@/lib/auth/context";
// MOCK_SECTION_ORDER lives in ./constants because Next.js 16 forbids
// non-async exports from "use server" files.
import { MOCK_SECTION_ORDER } from "./constants";

export type MockSectionState =
  | { section: Section; state: "not-started"; attemptId: null }
  | { section: Section; state: "in-progress"; attemptId: string }
  | { section: Section; state: "graded"; attemptId: string }
  | { section: Section; state: "skipped"; attemptId: null };

export type MockState = {
  mockId: string;
  track: Track;
  status: "InProgress" | "Submitted" | "Abandoned";
  startedAt: Date;
  submittedAt: Date | null;
  sections: MockSectionState[];
  currentSection: Section | null; // null when complete
};

// ─── Lifecycle actions ──────────────────────────────────────────────────

export async function startMockSession(formData: FormData): Promise<void> {
  const ctx = await requireOrgContext();
  const trackRaw = formData.get("track");
  if (trackRaw !== "Academic" && trackRaw !== "GeneralTraining") {
    throw new Error("Missing or invalid track.");
  }
  const db = withOrg(ctx);
  const session = await db.mockSession.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      track: trackRaw,
    },
    select: { id: true },
  });
  await db.activityLog.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      action: "mock.started",
      metadata: { mock_session_id: session.id, track: trackRaw } as Prisma.InputJsonValue,
    },
  });
  redirect(`/mock/${session.id}`);
}

export async function submitMockSession(formData: FormData): Promise<void> {
  const ctx = await requireOrgContext();
  const mockId = formData.get("mockId");
  if (typeof mockId !== "string" || mockId.length === 0) {
    throw new Error("Missing mockId.");
  }
  const db = withOrg(ctx);
  const session = await db.mockSession.findUnique({
    where: { id: mockId },
    select: { id: true, user_id: true, status: true },
  });
  if (!session || session.user_id !== ctx.user_id) {
    throw new Error("Mock session not found.");
  }
  if (session.status !== "InProgress") {
    redirect(`/mock/${mockId}/result`);
  }
  await db.mockSession.update({
    where: { id: session.id },
    data: { status: "Submitted", submitted_at: new Date() },
  });
  await db.activityLog.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      action: "mock.submitted",
      metadata: { mock_session_id: session.id } as Prisma.InputJsonValue,
    },
  });
  redirect(`/mock/${mockId}/result`);
}

export async function abandonMockSession(formData: FormData): Promise<void> {
  const ctx = await requireOrgContext();
  const mockId = formData.get("mockId");
  if (typeof mockId !== "string" || mockId.length === 0) {
    throw new Error("Missing mockId.");
  }
  const db = withOrg(ctx);
  const session = await db.mockSession.findUnique({
    where: { id: mockId },
    select: { id: true, user_id: true, status: true },
  });
  if (!session || session.user_id !== ctx.user_id) {
    throw new Error("Mock session not found.");
  }
  if (session.status === "InProgress") {
    await db.mockSession.update({
      where: { id: session.id },
      data: { status: "Abandoned", submitted_at: new Date() },
    });
    await db.activityLog.create({
      data: {
        org_id: ctx.org_id,
        user_id: ctx.user_id,
        action: "mock.abandoned",
        metadata: { mock_session_id: session.id } as Prisma.InputJsonValue,
      },
    });
  }
  redirect("/mock");
}

// ─── State + section advancement ────────────────────────────────────────

// Reads the current state of a mock — used by the orchestrator route to
// decide whether to route the learner to the next section runner, mark
// the session as complete, or show "no test available" guidance.
export async function readMockState(
  ctx: OrgContext,
  mockId: string,
): Promise<MockState | null> {
  const db = withOrg(ctx);
  const session = await db.mockSession.findUnique({
    where: { id: mockId },
    select: {
      id: true,
      user_id: true,
      track: true,
      status: true,
      started_at: true,
      submitted_at: true,
      attempts: {
        select: {
          id: true,
          section: true,
          status: true,
        },
      },
    },
  });
  if (!session || session.user_id !== ctx.user_id) return null;

  // Index attempts by section; in v1 we create at most one per section
  // per mock, but defensively pick the most-progressed if there are
  // duplicates.
  const bySection = new Map<Section, { id: string; status: string }>();
  for (const a of session.attempts) {
    const existing = bySection.get(a.section);
    if (!existing) {
      bySection.set(a.section, { id: a.id, status: a.status });
      continue;
    }
    // Prefer Graded > Submitted > InProgress > Abandoned.
    const rank = (s: string) =>
      s === "Graded" ? 3 : s === "Submitted" ? 2 : s === "InProgress" ? 1 : 0;
    if (rank(a.status) > rank(existing.status)) {
      bySection.set(a.section, { id: a.id, status: a.status });
    }
  }

  const sections: MockSectionState[] = MOCK_SECTION_ORDER.map((section) => {
    const a = bySection.get(section);
    if (!a) return { section, state: "not-started", attemptId: null };
    if (a.status === "Graded") {
      return { section, state: "graded", attemptId: a.id };
    }
    if (a.status === "Abandoned") {
      return { section, state: "skipped", attemptId: null };
    }
    return { section, state: "in-progress", attemptId: a.id };
  });

  // Current section is the first non-graded non-skipped section.
  let currentSection: Section | null = null;
  for (const s of sections) {
    if (s.state !== "graded" && s.state !== "skipped") {
      currentSection = s.section;
      break;
    }
  }

  return {
    mockId: session.id,
    track: session.track,
    status: session.status,
    startedAt: session.started_at,
    submittedAt: session.submitted_at,
    sections,
    currentSection,
  };
}

export type EnsureAttemptResult =
  | { ok: true; attemptId: string }
  | { ok: false; error: "no-test-available" | "session-not-found" };

// Ensures an Attempt exists for (mockId, section). Creates one if not,
// picking the earliest approved Test for the mock's track + section.
// Returns the attemptId for the orchestrator to redirect to. If no
// approved Test exists, returns 'no-test-available' so the orchestrator
// can render a skip affordance.
export async function ensureMockSectionAttempt(
  ctx: OrgContext,
  mockId: string,
  section: Section,
): Promise<EnsureAttemptResult> {
  const db = withOrg(ctx);
  const session = await db.mockSession.findUnique({
    where: { id: mockId },
    select: {
      id: true,
      user_id: true,
      track: true,
      status: true,
      attempts: {
        where: { section },
        select: { id: true, status: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!session || session.user_id !== ctx.user_id) {
    return { ok: false, error: "session-not-found" };
  }
  if (session.attempts[0]) {
    return { ok: true, attemptId: session.attempts[0].id };
  }
  // Pick an approved Test for this section + track. Test is global —
  // withOrg passes through unscoped.
  const test = await db.test.findFirst({
    where: { section, track: session.track, status: "Approved" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!test) {
    return { ok: false, error: "no-test-available" };
  }
  const attempt = await db.attempt.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      test_id: test.id,
      section,
      status: "InProgress",
      mock_session_id: session.id,
    },
    select: { id: true },
  });
  return { ok: true, attemptId: attempt.id };
}

// Form action — called from the orchestrator UI when the learner clicks
// "Skip this section" because no approved test was available (or they
// can't take Speaking in this env). Marks the section as skipped on the
// mock by writing an Abandoned Attempt against a placeholder test, OR
// — when no Test exists at all — by creating a stub Attempt against
// any Test we can find. v1: we simply move on without creating a row,
// letting readMockState surface "skipped" by the absence of a Test +
// our local flag. To make that work without a stub row, we record a
// `mock.section.skipped` ActivityLog instead.
export async function skipMockSection(formData: FormData): Promise<void> {
  const ctx = await requireOrgContext();
  const mockId = formData.get("mockId");
  const sectionRaw = formData.get("section");
  if (
    typeof mockId !== "string" ||
    typeof sectionRaw !== "string" ||
    mockId.length === 0
  ) {
    throw new Error("Missing mockId or section.");
  }
  const section = parseSection(sectionRaw);
  if (!section) throw new Error("Invalid section.");

  const db = withOrg(ctx);
  const session = await db.mockSession.findUnique({
    where: { id: mockId },
    select: { id: true, user_id: true, status: true, track: true },
  });
  if (!session || session.user_id !== ctx.user_id) {
    throw new Error("Mock session not found.");
  }
  if (session.status !== "InProgress") {
    redirect(`/mock/${mockId}`);
  }
  await db.activityLog.create({
    data: {
      org_id: ctx.org_id,
      user_id: ctx.user_id,
      action: "mock.section.skipped",
      metadata: {
        mock_session_id: session.id,
        section,
      } as Prisma.InputJsonValue,
    },
  });
  // No Attempt row — the orchestrator interprets the absence of an
  // Attempt + the ActivityLog as "skipped" via the readSkippedSections
  // helper below. The aggregate page then excludes skipped sections
  // from the band average.
  redirect(`/mock/${mockId}`);
}

// Reads the set of sections the learner explicitly skipped on this
// mock. Used by the orchestrator + aggregate to distinguish "not yet
// reached" from "deliberately skipped".
export async function readSkippedSections(
  ctx: OrgContext,
  mockId: string,
): Promise<Set<Section>> {
  const db = withOrg(ctx);
  const logs = await db.activityLog.findMany({
    where: {
      user_id: ctx.user_id,
      action: "mock.section.skipped",
    },
    select: { metadata: true },
  });
  const skipped = new Set<Section>();
  for (const log of logs) {
    const meta = log.metadata as { mock_session_id?: string; section?: string } | null;
    if (!meta) continue;
    if (meta.mock_session_id !== mockId) continue;
    const section = parseSection(meta.section ?? "");
    if (section) skipped.add(section);
  }
  return skipped;
}

function parseSection(s: string): Section | null {
  if (
    s === "Listening" ||
    s === "Reading" ||
    s === "Writing" ||
    s === "Speaking"
  ) {
    return s;
  }
  return null;
}
