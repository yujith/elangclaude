# ADR 0004 — OpenRouter adapter + `reading-generate` activation

Status: Accepted
Date: 2026-05-12

## Context

Phase 5 of the Reading feature plan activates the `reading-generate` purpose
in the AI gateway. Today the purpose exists in the model registry but its
`allowed` array is empty — any call is rejected with `ModelNotAllowedError`.
That is deliberate: nothing should be able to bill against the purpose
before the cost discipline below is written down.

This ADR records:

1. **Provider choice** — OpenRouter, not direct provider SDKs.
2. **Model choice** — three cheap-tier models, with one default and two
   fallback options the SuperAdmin can route to manually.
3. **Cost ceiling per call** and the per-user/per-org quota implications.
4. **The validator-rejection threshold gate** that controls when generation
   can be opened beyond SuperAdmin.

## Decisions

### D1 — OpenRouter as the cheap-tier provider

Per `.claude/rules/architecture.md`, "OpenRouter for cheap routes, direct
Anthropic for grading." Reading generation is the canonical cheap-route
purpose: low cost per call, high call volume, no rubric reasoning required.

Going through OpenRouter rather than provider-specific SDKs means:

- One adapter handles Gemini Flash, Llama, Mistral, and any future cheap
  tier we want to add or swap.
- The model registry remains the single source of truth — switching the
  default is a one-line change in `models.ts`, not a code change in
  `adapters/`.
- We pay a small routing fee for the convenience. Acceptable in v1.

### D2 — Three model entries on the `reading-generate` allowlist

| Role | Model | OpenRouter id |
|---|---|---|
| **Default** | Gemini 2.0 Flash | `google/gemini-2.0-flash-001` |
| Fallback | Llama 3.3 70B Instruct | `meta-llama/llama-3.3-70b-instruct` |
| Fallback | Mistral Large (latest) | `mistralai/mistral-large-2411` |

Default rationale: Gemini Flash has the best JSON-mode reliability per
public benchmarks in the price band we care about, and OpenRouter's
billing for it is well under US$0.01 per generated passage at our token
budget. The two fallbacks exist so a SuperAdmin can manually re-roll a
passage if Gemini produces persistent validator failures on a topic.
Auto-fallback on a single call is **not** wired in v1 — too easy to burn
budget without realising.

### D3 — Per-call cost ceiling

Each generation call is hard-capped at:

- **Input tokens:** prompt is ~3,000 tokens (the canonical prompt at
  `prompts/generation/reading.md` plus a system header).
- **Output tokens:** `max_tokens = 6000`. A full passage + 6–10 questions
  + answer key in the structured JSON fits comfortably under this, with
  enough headroom for validator repair attempts that need a longer passage.
- **Worst-case cost per call (Gemini 2.0 Flash, May 2026 rates):** roughly
  US$0.0006 input + US$0.0036 output = **~$0.004 per generation attempt**.
- **Llama 3.3 / Mistral Large fallback ceiling:** ~$0.01 per call.

These numbers go in the cost dashboard alongside the existing Writing
grading line item.

### D4 — Quota lives where it already does

Generation calls bill the **SuperAdmin's** `QuotaUsage` row, not an org
admin's or a learner's. Implications:

- The SuperAdmin's parent organisation must be configured with a higher
  `quota_daily` than a typical demo org. The seed currently gives Org A
  (`Demo English Academy`) a quota of 100/day, which is also the
  SuperAdmin's home org — that's fine for the v1 trickle of generations.
- When generation becomes a daily workflow, the SuperAdmin moves to a
  dedicated "system" org with its own (higher) quota. Tracking issue in
  Phase 6.
- The existing gateway-level `reserveQuota` / `refundQuota` covers
  generation exactly as it covers grading. No new accounting required.

### D5 — Validator repair attempts and rejection threshold gate

The generator may make up to three attempts for a single request. Malformed
JSON/schema failures get a strict JSON reminder. Schema-valid but
semantically invalid Reading output gets a validator-specific repair prompt
with stable issue codes. A generation is rejected at the validator step only
after the retry budget is exhausted and any of the following still fails:

- The output is not valid JSON, or does not match the Zod schema.
- A `sentence-completion` or `short-answer` accepted string is not locatable
  in the passage (soft-normalised substring search).
- The correct MCQ option is not grounded in any substantive passage token
  or number.
- The passage word count falls outside 600–950 (Academic) or 400–800
  (GeneralTraining).
- General Training output omits `passage.gt_context`.
- Paragraph count, paragraph labels, question count, or question positions
  drift from the Reading prompt contract.
- The model returns a different `track` from the caller's requested track.

The gate for opening generation beyond SuperAdmin is **validator-
rejection rate ≤ 30%** over a rolling sample of at least 20 generations.
Below that we trust SuperAdmin review as the sole filter; above that, the
prompt or the model needs to change before the surface opens further.
Tracking the rate is informal in Phase 5 (the SuperAdmin's eyeballs);
Phase 6 lands a counter on `ActivityLog`.

### D6 — Generated tests land as `PendingReview`, never `Approved`

The learner picker filters `status = Approved`, so a generated test
**cannot reach a learner** without a SuperAdmin promoting it. This is the
correctness backstop behind the cost discipline above: the system can
generate cheaply and rejection rates can drift without learner-visible
damage.

The PendingReview → Approved flip is the entry point for Phase 6's
SuperAdmin moderation console.

## Consequences

- `packages/ai/src/adapters/openrouter.ts` lands, implementing the
  existing `Provider` shape. The gateway production export replaces its
  placeholder `openrouter: () => { throw … }` with the real adapter.
- `packages/ai/src/models.ts` adds three OpenRouter entries to the
  `reading-generate` allowlist and changes the purpose's `default` to
  Gemini Flash.
- `prompts/generation/reading.md` is the canonical generation prompt,
  versioned in PRs alongside any prompt revisions.
- `packages/ai/src/generation/reading.ts` orchestrates the call, the
  schema validation, the answer-locatable validator, and persistence.
- A SuperAdmin-only server action invokes the pipeline. No learner-facing
  UI ships in Phase 5; the moderation console is Phase 6.
- `OPENROUTER_API_KEY` is required at runtime; it's already in
  `packages/db/.env`. CI does not require it because the contract test
  uses a recorded fixture.

## Alternatives considered

- **Direct Google / Anthropic / Meta SDKs.** Rejected on grounds of dep
  bloat and the need for an in-house fallback router. OpenRouter handles
  both for the price band we're targeting.
- **Auto-fallback on a single failed call.** Rejected for v1 because it
  doubles the cost ceiling per generation without any UI to show the
  SuperAdmin which model was used. Manual re-roll keeps the cost story
  clean.
- **Letting the gateway pick the model at random across the allowlist.**
  Rejected for the same reason — predictability beats marginal robustness
  in a SuperAdmin-only workflow.
- **Generating every question type in v1, including matching and
  completion-blank.** Rejected for Phase 5. The prompt ships with MCQ +
  TFNG/YNNG + sentence-completion + short-answer only. Matching and
  completion-blank generation lands in a follow-up after we've seen the
  validator-rejection rate on the easier kinds.
