// Pure lifecycle policy for already-decided Test content (retire / reopen /
// delete). Kept free of Prisma, Clerk, and Next so it is trivially unit-
// testable; the SuperAdmin server actions in apps/web supply the I/O (load the
// row, count attempts, write the row + ActivityLog, redirect) and call these to
// decide WHAT should happen.
//
// Reusing the existing `Rejected` status for "retire" is a deliberate choice
// (no migration); the action records a distinct `content.{section}.retired`
// ActivityLog so the audit trail still separates "failed review" from "was
// live, then pulled". See the approved-content plan (P1).

export type TestStatusName =
  | "Draft"
  | "PendingReview"
  | "Approved"
  | "Rejected";

// Outcome of a status-changing lifecycle request.
//   proceed    — apply `nextStatus`.
//   idempotent — already in the target state; treat as a no-op success.
//   invalid    — not allowed from `currentStatus`.
export type TransitionDecision =
  | { kind: "proceed"; nextStatus: TestStatusName }
  | { kind: "idempotent" }
  | { kind: "invalid"; currentStatus: TestStatusName };

// Retire pulls a live test out of the learner pool: Approved → Rejected.
export function planRetire(status: TestStatusName): TransitionDecision {
  if (status === "Approved") return { kind: "proceed", nextStatus: "Rejected" };
  if (status === "Rejected") return { kind: "idempotent" };
  return { kind: "invalid", currentStatus: status };
}

// Reopen sends a live test back through review: Approved → PendingReview.
export function planReopen(status: TestStatusName): TransitionDecision {
  if (status === "Approved") {
    return { kind: "proceed", nextStatus: "PendingReview" };
  }
  if (status === "PendingReview") return { kind: "idempotent" };
  return { kind: "invalid", currentStatus: status };
}

// Outcome of a hard-delete request. A test is only deletable when NO learner
// has attempted it — Attempt.test cascades to Answer/Grade/Recording, so
// deleting an attempted test destroys learner history across every org.
export type DeleteDecision =
  | { kind: "proceed" }
  | { kind: "blocked"; reason: "has_attempts"; attemptCount: number };

export function planDelete(attemptCount: number): DeleteDecision {
  if (attemptCount > 0) {
    return { kind: "blocked", reason: "has_attempts", attemptCount };
  }
  return { kind: "proceed" };
}
