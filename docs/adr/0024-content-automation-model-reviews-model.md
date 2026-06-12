# ADR-0024 — Content automation: scheduled generation with a model-reviews-model gate

- **Status:** Accepted
- **Date:** 2026-06-10
- **Owner:** SuperAdmin content pipeline
- **Relates to:** ADR-0004 (generation), ADR-0009..0012 (contract guards),
  ADR-0020 (OpenAI generation default), ADR-0021 (approved-content lifecycle)

## Context

SuperAdmin moderation is the content-pool bottleneck (BRIEF §15.3 flagged
this from day one and suggested "tiered approval"). The ask: schedule
generation batches that run unattended, have a second model review each
generated unit, and — when the reviewer approves — publish to learners
with no human in the loop, while keeping a full audit trail and instant
kill switches.

## Decisions

### D1 — Reviewer model: Claude Sonnet, a new `content-review` purpose

The reviewer verdict *replaces the human gate*, so it gets the
grading-tier model, not the generation tier. This is the ONE sanctioned
Sonnet purpose outside grading (`packages/ai/src/models.ts`); the
rationale mirrors grading — rubric-style reasoning — plus cross-vendor
diversity: a gpt-4.1-mini generator reviewed by gpt-4.1-mini would share
its blind spots. Review prompts live in `prompts/review/{section}.md`
and focus on what the mechanical validators CANNOT check (answer-key
correctness against the passage/transcript, T/F/NG discipline, visual
data coherence, cue-card sustainability, cultural fairness). Verdict is
strict JSON (`reviewVerdictSchema`): `approve`/`reject`, severity-tagged
issues, and `feedback_for_regeneration` (required on reject; a reject
must carry ≥1 critical issue).

### D2 — Feedback loop: 3 generations max, revision via the repair channel

`runAutomationItem` (`packages/ai/src/automation/engine.ts`, pure deps)
drives generate → review → regenerate. On reject, the next generation
seeds the conversation with the rejected unit + the reviewer's feedback
(`revision` option on all four generators) — the same multi-turn repair
shape the validators already use. Budget: 3 generations per slot.
Intermediates are flipped `Rejected` (logged `content.{section}.auto_rejected`);
on exhaustion the LAST candidate stays `PendingReview` for human rescue
(`auto_review_exhausted`). A reviewer-rejected unit is **never** published.

### D3 — Two SuperAdmin kill switches, checked server-side at execution

`AutomationSettings` singleton: `generation_enabled` (master — cron
no-ops when off; "Run now" still works as the rehearsal path) and
`auto_publish_enabled` (off → reviewer-approved units land in
`PendingReview` pre-screened, with the verdict attached — the soft-launch
dial). Every flip writes ActivityLog (`content.automation.*`) under
`SYSTEM_ORG_ID`.

### D4 — Publish path reuses the human approval machinery

Before any flip the runner re-runs the section's second contract gate —
`validate{Reading,Writing,Speaking}ReviewRecord`, `parseListeningContent`
for Listening — then sets `Approved` with **`approved_by = null`**
(machine approvals are distinguishable; the verdict trail lives on
`GenerationRunItem.verdicts`), logs `content.{section}.auto_approved`,
and for Listening runs the shared TTS synth (extracted to
`lib/listening/synth.ts`; partial synth failure does not roll back
approval, mirroring the human path). Rollback story is ADR-0021 retire.

### D5 — Scheduling: SuperAdmin-local wall clock, hourly UTC cron

`GenerationSchedule` carries an IANA `timezone` (default
`Australia/Sydney`). One-off: local date+time converted to a UTC
`run_at` at save (`localDateTimeToUtc`, two-pass DST-safe via Intl —
unit-tested across both Sydney DST boundaries). Recurring: Daily/Weekly
with schedule-local `run_hour`/`weekday`, evaluated by `isScheduleDue`
with catch-up semantics (a missed tick fires later the same local day;
at most one run per local day). Cron: Vercel Cron →
`/api/cron/content-generation`, `CRON_SECRET` bearer (retention
pattern). Designed for an hourly tick; **Vercel Hobby allows only
once-per-day crons** (a faster expression fails the whole deployment),
so the shipped schedule is daily at 08:00 UTC (≈18:00 Sydney). The
catch-up due-check degrades gracefully — every schedule whose local
run time has passed fires at the tick — but recurring `run_hour`s
later than the tick's local hour never fire. Restore `0 * * * *` on
Pro, or drive the endpoint hourly from an external scheduler. Concurrency: schedules are claimed with an optimistic
`updateMany` guard on `last_run_at` before any work — overlapping
invocations lose the claim. One-offs disable themselves in the claim
write. Throughput guards: ≤2 schedules per tick, ≤10 tests per run
(Listening ≤3 — TTS dominates the 300s function budget), per-day backstop
via D6.

### D6 — Identity, quota, and cost attribution: the SYSTEM org

Scheduled runs execute as the schedule's **creator** (verified at run
time to still be a live SuperAdmin — `resolveActingSuperAdmin`; a
demoted/deleted creator fails the run visibly). The gateway context is
`{ org_id: SYSTEM_ORG_ID, user_id: creator }`: every AI call passes the
NORMAL quota gate against the system org's dedicated `quota_daily`
(2000 — seed + data migration `20260610083400`), and `AiCallLog` rows
land under the system org. No quota-bypass code path exists; a runaway
loop strangles itself. Manual "Run now" executes as the acting
SuperAdmin but bills the system org the same way (deviation from
ADR-0004 D4's home-org billing — automation spend must be separable on
the cost dashboard).

### D7 — Audit surface

`GenerationRun`/`GenerationRunItem` record per-slot outcomes
(`Published | PendingHumanReview | Failed`), generation attempts, and
the full per-attempt verdict JSON. `/content/automation` hosts toggles,
schedule CRUD, "Run now", and run history; `/content/automation/runs/[id]`
renders every verdict; auto-published tests carry an "Auto" badge in
the per-section Approved lists. Watch the approve rate per section — a
~100% approve rate means the reviewer is rubber-stamping, not that the
generator is perfect.

## Costs

Per published unit, worst case (3 cycles): generation ~$0.005–0.02 ×3
(gpt-4.1-mini) + review ~$0.02–0.06 ×3 (Sonnet; Listening payloads are
the biggest) → roughly **$0.03–0.10 per published Reading/Writing/
Speaking test**; Listening adds ~40 ElevenLabs clips at publish (the
dominant Listening cost, cache-deduped). Volume is schedule-bound and
capped; all spend is visible per-purpose in `AiCallLog`.

## Consequences

- Learners can see content no human has read. Accepted deliberately —
  mitigations: cross-vendor Sonnet review, contract validators running
  twice, verdict audit trail, Auto badge, ADR-0021 retire, two kill
  switches, soft-launch via auto-publish-off.
- The Sonnet allowlist exception is scoped to `content-review` only;
  generation purposes still exclude Sonnet.
- Weekly schedules missed for a whole local day (cron outage >15h) skip
  to the next week; daily schedules self-heal the same day.
- The cron function processes at most 2 schedules/tick sequentially; a
  long Listening batch can push the 300s ceiling — keep Listening counts
  small, move synth to a queue if volume grows (existing Phase 7 note).

## Follow-ups

- End-to-end approve-rate metric on `/metrics`.
- Benchmark reviewer verdicts against human moderation decisions on a
  sample (defensibility, mirrors the grading open question).
- Consider auto-reviewing *manually generated* pending tests as a
  pre-screen.
