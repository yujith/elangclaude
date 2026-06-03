// Pure helpers for the full Reading paper (3 passages, one sitting).
//
// A ReadingPaper is an ordered bundle of three approved passage-Tests in
// slots 1/2/3. These helpers own the assembly rules — kept pure so the
// server actions (paper-actions.ts) and unit tests share one contract and
// neither touches Prisma here.

export const READING_PAPER_SLOTS = [1, 2, 3] as const;
export type ReadingPaperSlot = (typeof READING_PAPER_SLOTS)[number];

export type CandidatePart = {
  slot: ReadingPaperSlot;
  testId: string;
  // The candidate Test's facts, as read from the DB by the caller.
  track: "Academic" | "GeneralTraining";
  section: string;
  status: string;
};

export type CurationIssue =
  | { code: "missing-slot"; slot: ReadingPaperSlot }
  | { code: "duplicate-test"; testId: string }
  | { code: "wrong-section"; testId: string }
  | { code: "wrong-track"; testId: string }
  | { code: "not-approved"; testId: string };

// Validate a 3-part curation against the paper's track. The caller passes
// the candidate parts already hydrated with the Test facts; we never trust
// client-provided track/status — those come from a DB read keyed by id.
export function validateCuration(
  paperTrack: "Academic" | "GeneralTraining",
  parts: CandidatePart[],
): CurationIssue[] {
  const issues: CurationIssue[] = [];

  // One part per slot, exactly three.
  for (const slot of READING_PAPER_SLOTS) {
    if (!parts.some((p) => p.slot === slot)) {
      issues.push({ code: "missing-slot", slot });
    }
  }

  // No passage reused across two slots of the same paper.
  const seen = new Set<string>();
  for (const p of parts) {
    if (seen.has(p.testId)) {
      issues.push({ code: "duplicate-test", testId: p.testId });
    }
    seen.add(p.testId);
  }

  for (const p of parts) {
    if (p.section !== "Reading") {
      issues.push({ code: "wrong-section", testId: p.testId });
    }
    if (p.track !== paperTrack) {
      issues.push({ code: "wrong-track", testId: p.testId });
    }
    if (p.status !== "Approved") {
      issues.push({ code: "not-approved", testId: p.testId });
    }
  }

  return issues;
}

// A paper is releasable (can flip Draft → Approved, can be served to a
// learner) only when it has all three slots filled by Approved Reading
// passages of its own track. Reuses validateCuration so the rule lives in
// exactly one place.
export function paperIsComplete(
  paperTrack: "Academic" | "GeneralTraining",
  parts: CandidatePart[],
): boolean {
  return validateCuration(paperTrack, parts).length === 0;
}
