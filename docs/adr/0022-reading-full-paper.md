# ADR 0022 — Full Reading paper: a bundle of three passage-Tests + a sitting parent

Status: Accepted
Date: 2026-06-04

## Context

A real IELTS Reading paper is **3 passages of escalating difficulty, 40
questions, 60 minutes**. Until now our Reading model was a single
passage: one `Test` row whose `body_json` holds one `ReadingPassage`
(~13 questions), graded deterministically and shown one at a time
(ADR-0003). Two gaps followed from that:

1. SuperAdmins could not mark a generated passage as **Part 1/2/3** and
   learners could not filter/practice by part.
2. There was no way to take the **whole Reading paper in one sitting**,
   either standalone or as the Reading leg of the 4-section Full Mock
   (ADR-0008), whose Reading leg served a single passage.

## Decisions

### D1 — One passage is still one `Test`; a paper is an ordered bundle

We keep ADR-0003 intact (1 passage = 1 `Test`, deterministic grader, the
contract guards of ADR-0010 unchanged) and model a paper as a bundle of
three approved passage-`Test`s:

- `ReadingPaper` — **global** content (same class as `Test`): `track`,
  `status` (reuses `TestStatus`), `approved_by`, `title`. SuperAdmin-
  curated/approved, shared across all orgs. NOT tenant-scoped.
- `ReadingPaperPart` — join row binding a passage-`Test` into `slot`
  1/2/3. `@@unique([paper_id, slot])`. Cascade from the paper; cascade
  from the `Test` (a hard-deleted passage drops its slot, marking the
  paper incomplete, which curation/runner surface).

Rejected: collapsing three passages into one fat `Test.body_json`. It
would have forced a rewrite of the renderer, grader, and the ADR-0010
contract guards, and would have prevented reusing already-approved
single passages — which the "individual part" requirement needs.

### D2 — `part` rides in `body_json`, not a new column

A passage's IELTS part is additive metadata on the reading-owned
`body_json` (`part?: 1 | 2 | 3`), stamped by the SuperAdmin at generation
time. **Academic** uses the stamped value; **GT** derives its part from
the existing `gt_context` (social-survival → 1, workplace → 2,
general-reading → 3) via `readingPart()` — one source of truth, no
backfill migration, no parallel field. The per-passage part is a *filter
aid*; the paper *slot* is authoritative within a paper.

### D3 — A dedicated `ReadingPaperSession`, not an overloaded `MockSession`

The learner's full-paper sitting is a new **tenant-scoped**
`ReadingPaperSession` parenting three part `Attempt`s, mirroring the
proven `MockSession → Attempt` shape (ADR-0008 D1/D2): resumable, with
server-side forward-only progression derived from the joined attempts.
We did NOT generalise `MockSession` (its one-attempt-per-`Section`
assumption fights three Reading attempts). The session joins
`TENANT_SCOPED_MODELS`; the fuzzer is extended. `Attempt` gains a
nullable `reading_paper_session_id` (`onDelete: SetNull`, like
`mock_session_id`).

The single-passage runner is reused per part: `submitReadingAttempt`
detects a paper leg and routes back to the paper orchestrator (which
advances to the next part or the combined result) instead of the
single-passage result page.

### D4 — Combined band off the real 40-question curve

The paper result sums the three parts' `raw_correct` / `raw_total` and
looks up `bandFromPartial(track, sumCorrect, sumTotal)` — the published
40-question conversion, scaled to the paper's actual question count
(typically ~39). This is a *more* accurate calibration than the old
single-passage "scale 13 → 40" approximation, with a per-passage
breakdown shown alongside.

### D5 — The Full Mock's Reading leg IS a paper sitting

`ReadingPaperSession` gains a nullable `mock_session_id` (`onDelete:
SetNull`). When the 4-section mock reaches Reading, the orchestrator
calls `ensureMockReadingPaper` (mirrors `ensureMockSectionAttempt`),
creating a mock-linked sitting and routing to the paper orchestrator. The
three part attempts carry **both** `mock_session_id` and
`reading_paper_session_id`. `readMockState` derives the Reading section
state from the linked sitting's status (`Submitted` → graded, else
in-progress), NOT from a single attempt — so the mock advances to Writing
only when the **whole** paper is done. The mock result aggregates the
three Reading attempts the same way as D4. Falls back to the existing
skip affordance when no approved paper exists for the track.

Standalone resume queries exclude `mock_session_id != null` so a mock's
Reading leg is never resumed from the standalone "Full paper" tab.

## Consequences

- **Good:** every existing single-passage path (renderer, grader,
  contract guards, single-part practice) is untouched and reused. The
  mock change is contained to the Reading branch of three functions; the
  rollback is to revert that branch (single-passage selection still
  works).
- **Bad / follow-ups:** a paper needs three approved passages of the same
  track before it can be offered; until the pool fills, papers and the
  mock Reading leg may be unavailable (skip affordance covers it).
  "Generate full paper" for GT produces three passages by position, not
  one-per-`gt_context` — acceptable, since slots are positional. Curated
  GT papers can still hand-pick one passage per section.
- End-to-end manual QA of the mock Reading leg (seeded approved paper +
  browser run) is still pending; the logic is typecheck- and
  fuzzer-verified.

## See also

- ADR-0003 (Reading data shape), ADR-0008 (Mock session shape),
  ADR-0010 (Reading contract guards), ADR-0021 (Approved-content
  lifecycle — paper retire/delete follows the same "refuse if used"
  posture; paper delete is refused once any sitting exists).
