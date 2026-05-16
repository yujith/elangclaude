# ADR 0008 — Mock test session: a parent row with nullable FK from Attempt

Status: Accepted
Date: 2026-05-16

## Context

Phase 6 of the Listening feature plan (which is also the Full Mock
test feature for the platform as a whole) needs a data shape that lets
a learner take all four IELTS sections back-to-back as one cohesive
sitting, with two non-negotiable properties:

1. **Resumable.** A 2.5-3 hour mock cannot lose progress on a page
   refresh or laptop sleep. The current `Attempt` model is per-section
   and survives refresh fine — what's missing is something that ties
   four Attempts together as one logical session.
2. **Cross-section navigation lock.** Once a learner finishes Listening
   they should not be able to go back to it. That has to be enforced
   server-side, which means the server needs to know which section is
   "current" for any given mock.

Two paths considered:

- **Client-side chain.** A `/mock/[mockId]` route holds the section
  order in URL/sessionStorage and creates Attempt rows back-to-back via
  the existing per-section start actions. Lose progress on hard refresh
  unless we add session storage hydration. The navigation lock has to
  live in client state too, which is the wrong layer.
- **Parent `MockSession` row.** A new tenant-scoped model that owns
  the timing/lifecycle metadata, with the four section Attempts
  referencing it via a nullable FK. Resumable by definition; the lock
  is enforced server-side at the orchestrator route.

The parent row wins for everything except code volume; the schema cost
is one model + one FK + an enum.

## Decisions

### D1 — `MockSession` is a new tenant-scoped model

```prisma
enum MockStatus {
  InProgress
  Submitted
  Abandoned
}

model MockSession {
  id           String      @id @default(cuid())
  org_id       String
  org          Organization @relation(fields: [org_id], references: [id], onDelete: Cascade)
  user_id      String
  user         User        @relation(fields: [user_id], references: [id], onDelete: Cascade)
  track        Track
  status       MockStatus  @default(InProgress)
  started_at   DateTime    @default(now())
  submitted_at DateTime?
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  attempts     Attempt[]

  @@index([org_id])
  @@index([org_id, user_id])
  @@index([org_id, status])
}
```

It joins `TENANT_SCOPED_MODELS` in `packages/db/src/tenancy.ts`, so the
existing `withOrg(ctx)` proxy auto-scopes every read and write, and the
tenancy fuzzer (`packages/db/src/tenancy.test.ts`) is extended to
include it.

### D2 — `Attempt` gains a nullable `mock_session_id`

```prisma
model Attempt {
  // ... existing fields
  mock_session_id  String?
  mock_session     MockSession? @relation(fields: [mock_session_id], references: [id], onDelete: SetNull)

  @@index([mock_session_id])
}
```

`onDelete: SetNull` so deleting a `MockSession` (very rare — typically
abandonment, not deletion) leaves the underlying attempts standing as
standalone practice attempts. This matches the design of every other
relation off `Attempt`: the section work is the primary record; the
mock wrapper is metadata.

Standalone (non-mock) practice attempts leave the field `null` — the
existing learner picker / runner paths are unchanged. The mock
orchestrator is the only caller that sets it.

### D3 — `current_section` is derived, not stored

A naïve schema would put `current_section: Section?` on `MockSession`.
We don't, because the field would be a denormalisation of "the
unfinished Attempt belonging to this mock," and denormalisations drift.

The orchestrator route computes the current section on every request:

- Look up the four Attempts for this mock by `(mock_session_id,
  section)`.
- Walk the section order (Listening → Reading → Writing → Speaking).
- The first section that is either missing or has `status !=
  Graded`/`Submitted` is "current."
- If all four are graded, the mock is complete.

Cheap, correct, no rebalancing needed when the schema gains more
section states. The mock orchestrator is the only consumer.

### D4 — Section order is fixed: Listening → Reading → Writing → Speaking

Same as the live IELTS exam order (modulo Speaking, which the real
exam schedules separately — we treat it as the fourth leg of the
sitting, with an exception path if the Realtime API env is missing).

Hard-coding the order in the orchestrator (a constant `MOCK_SECTION_ORDER`
in `apps/web/lib/mock/actions.ts`) is cheaper than a schema column and
keeps the data model honest about the fact that an unordered set of
section ids is not the same thing as a sequence.

### D5 — Speaking is optional within a mock

The real exam separates Speaking; our platform combines them but
Speaking depends on the OpenAI Realtime API. If the env isn't set
(common in dev environments without OPENAI_API_KEY), the orchestrator
marks Speaking as `Skipped` on the per-section status board and
proceeds to the aggregate. The aggregate band averages over the
sections that DID complete.

This avoids the failure mode where a dev environment can never finish
a mock because Speaking never starts.

### D6 — Aggregate band is the mean of section bands, rounded to the nearest 0.5

Per the IELTS Domain skill (`ielts-domain.md:24`): "Overall band is the
average of the four section bands, rounded to the nearest half band."
The aggregate page implements exactly that, and surfaces the per-
section bands alongside.

## Consequences

- One Prisma migration adds `MockSession` + the FK + the enum + three
  indexes. Idempotent and additive — no risk to existing rows.
- `tenancy.ts` `TENANT_SCOPED_MODELS` set grows to include
  `MockSession`. The fuzzer's structural cross-check still passes.
- `apps/web/lib/mock/actions.ts` and `apps/web/app/(learner)/mock/...`
  land in Phase 6. Existing per-section flows are unchanged.
- The Listening runner already accepts `mode="strict"` (Phase 5). The
  mock orchestrator routes to `/practice/listening/[attemptId]` and
  the runner reads `attempt.mock_session_id` to decide whether to opt
  into strict mode. Reading + Writing + Speaking runners get the same
  hook in Phase 6 (initially as a no-op for Reading / Writing — they
  already lack a timer-locked variant; Phase 7 follow-up).
- The aggregate result page lives at `/mock/[mockId]/result` and reads
  the four section grades directly off the joined Attempt rows.

## Alternatives considered

- **Client-side chaining without a parent row.** Rejected — see
  "Resumable" above. Refresh-survival via sessionStorage is doable but
  the navigation-lock guarantee leaks to the client.
- **`MockSession.attempt_ids: String[]`** instead of an FK from
  Attempt. Rejected — Postgres array columns are a code smell in
  Prisma, and we lose `onDelete` referential integrity.
- **A four-column `MockSession.listening_attempt_id`,
  `reading_attempt_id`, etc.** Rejected — explicit but rigid; adding a
  fifth section (or splitting Speaking into two parts later) becomes a
  migration. The 1:N FK pattern is cheaper to evolve.
- **Storing `current_section` on the row** — see D3.
- **A separate `MockSectionSlot` join model.** Rejected — joins for the
  sake of joins. The four Attempt rows already have everything we
  need, addressed by `(mock_session_id, section)`.
