# Sub-processor register

Canonical internal record of third parties that process personal data on our
behalf. Keep in lockstep with the public `/sub-processors` page. Last reviewed:
2026-06-01.

| Sub-processor | Purpose | Data categories | Location | DPA in place |
|---|---|---|---|---|
| Vercel | App hosting / delivery | All request data in transit | US / global edge | Required |
| Neon (Postgres) | Primary database | All account, practice, consent data | Sydney, AU | Required |
| Clerk | Authentication / identity | Name, email, credentials | US | Required |
| Stripe | Payments / billing | Billing metadata, email | US / global | Required |
| Cloudflare R2 | Speaking recording storage | Voice recordings (sensitive) | Global object storage | Required |
| OpenAI | Speaking realtime, transcription, some grading | Speaking audio, transcripts, written answers | US | Required (no-training) |
| Anthropic | Writing + Speaking grading | Written/spoken responses, transcripts | US | Required (no-training) |
| OpenRouter | Reading/Listening/Writing generation | Prompt inputs (no learner PII) | US | Required |
| ElevenLabs | Listening TTS | Generated text (no learner PII) | US | Required |
| Resend | Transactional + opt-in marketing email | Name, email | US | Required |
| Sentry | Error monitoring (consent-gated) | Error context, possibly user id | US | Required |
| PostHog | Product analytics (consent-gated) | Usage events, user id | EU / US | Required |

## Notes

- **Consent-gated** vendors (Sentry, PostHog) must not initialise until the
  user has granted analytics consent. They are not yet wired into the app; when
  added, gate them on the consent cookie / `cookies_analytics` ledger state.
- **No-training** vendors are contractually barred from training models on our
  data; confirm this clause survives each contract renewal.
- Cross-border transfers from the EEA/UK rely on Standard Contractual Clauses
  (and the UK Addendum). Keep executed copies on file.

## Change log

- 2026-06-01 — Initial register (ADR-0019).
