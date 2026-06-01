# ADR 0019 — Legal compliance: policies, consent, data-subject rights, retention

- Date: 2026-06-01
- Status: Accepted (Phases 1–4 shipped 2026-06-01). Policy copy is published
  live and is **pending review by qualified counsel in each target
  jurisdiction** before it should be relied on as final — see "Counsel review".

## Context

Until now the only "legal" surface was three `mailto:` links in the site
footer ("Privacy on request", "Terms on request", "Delete my data"). That is
not defensible for a B2B SaaS selling into the EU/UK, Australia, South Asia
(India DPDP, Sri Lanka PDPA — the British Council Sri Lanka is a named pitch
target), and Southeast Asia (Singapore/Malaysia/Thailand/Indonesia/Philippines/
Vietnam). We also ship Speaking voice recordings (sensitive data) with no
retention enforcement, and `docs/BRIEF.md` left "audio retention default" as an
open question.

We need: published, accessible, versioned policies; opt-in consent for
non-essential cookies; in-app data-subject-rights (access/portability/
rectification/erasure); automated retention; and the records those regimes
require (DPA, sub-processor list, ROPA, breach runbook).

The feature plan was produced via `/plan-feature`.

## Decisions

### D1 — Controller vs processor split, stored per-org

`Organization.controller_model` (`CustomerControlled | PlatformControlled`):

- **Org-seat learners** (seeded + invite funnels) → `CustomerControlled`: the
  buying Organization is the controller, eLanguage Center is the **processor**.
  Covered by the DPA + sub-processor list.
- **Self-serve individuals** → `PlatformControlled`: eLanguage Center is the
  **controller**; the Privacy Policy governs directly.

`provisionSelfServeOrg` sets `PlatformControlled`; the migration backfills
existing self_serve orgs. We store rather than derive so an org's posture is
explicit and overridable.

### D2 — Data residency: disclose + per-org flag, no localization yet

`Organization.data_region` (`syd1` only in v1) is the disclosure hook. We keep
the single Sydney region (co-located with Neon per the region-colocation rule)
and disclose cross-border transfer + SCC safeguards in the Privacy Policy.
Actually offering another region is a deliberate, ADR-gated change — adding an
enum value here is the trigger to do that work, never an implicit capability.

### D3 — Minors: coarse age band, not date of birth

`User.age_assurance` (`Unknown | Adult | Minor`) + `guardian_email` +
`guardian_consent_at`. We deliberately do **not** store full DOB (data
minimisation). `Minor` requires guardian consent (DPDP under-18, GDPR Art 8).
The capture UI lives on `/profile`. **Follow-up:** a hard gate blocking practice
for a `Minor` without `guardian_consent_at` is not yet wired into the practice
routes — the data + capture exist; enforcement at the route layer is a
documented next step.

### D4 — Erasure is queued, then executed by a job

A learner's erasure creates a `Pending` `DataRightsRequest`. The daily
retention job (`processPendingErasures`) actions it only after a 24h
cancellation window: it deletes recordings from R2, deletes attempts (cascading
answers/grades/recordings), mock sessions, quota usage and the consent ledger,
then scrubs the `User` row to an unidentifiable tombstone (`erased_at` +
`deleted_at` set, email → `erased+{id}@deleted.invalid`, name/clerk id nulled).
The `DataRightsRequest` + an ActivityLog row survive as proof the erasure
happened. An accidental click is recoverable via `cancelErasure` during the
window.

### D5 — Consent ledger is org-scoped; anonymous choices stay client-side

`ConsentRecord` is tenant-scoped (`org_id` + `user_id` both non-null). Anonymous
marketing-site visitors' cookie choices live in a first-party `elc_consent`
cookie only — no org-less server rows. Once the chooser is authenticated,
`/api/consent` snapshots the choice into the ledger. We store a salted hash of
the IP, never the raw address. Consent binds to a policy version string
(`lib/legal/policies.ts`) so we can re-prompt on material changes.

### D6 — Policy content as React, not a CMS or markdown dep

Policy copy is authored as brand-styled React in `components/legal/*` +
`app/{privacy,terms,cookies,dpa,sub-processors}/page.tsx`. Metadata + version
strings live in `lib/legal/policies.ts`. No markdown runtime dependency (the
architecture rules discourage new component/lib deps), full control over
accessibility and tables, and the copy is reviewed in PRs like the prompts are.

### D7 — Retention default 90 days, system job

`DEFAULT_RECORDING_RETENTION_DAYS = 90` closes the BRIEF open question. The
`/api/cron/retention` route (Vercel Cron, daily 03:00, CRON_SECRET bearer) runs
the purge + erasure jobs. **Follow-up:** per-org retention override is a
documented next step (constant today, no schema column yet).

## Counsel review

The published policy text is good-faith, jurisdiction-aware drafting but is
**not** a substitute for licensed counsel. Before relying on it as final, have
counsel review per jurisdiction: GDPR/UK, Australia (Privacy Act/APPs), India
(DPDP 2023), Sri Lanka (PDPA 2022), and the SEA PDPAs. Update
`docs/compliance/*` and bump versions in `lib/legal/policies.ts` on any change.

## Consequences

- Footer legal links now point to real pages; sign-up records Terms/Privacy
  acceptance; cookies are consent-gated (PostHog/Sentry, when wired, must read
  consent before initialising).
- New tenant-scoped models in the fuzzer set; 14 new unit tests.
- `withOrg` everywhere for DSR; erasure/retention are system jobs using raw
  prisma (documented exception, like seed/webhooks).
