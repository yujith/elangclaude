# Records of Processing Activities (ROPA)

GDPR Art 30 record. Mirrors equivalent obligations under Australia's APPs,
India's DPDP, and the SEA PDPAs. Last reviewed: 2026-06-01.

## Controller details

- **Self-serve individuals:** eLanguage Center is the controller.
- **Org-seat learners:** the buying Organization is the controller; eLanguage
  Center is the processor (see `Organization.controller_model`).
- Contact: privacy@elanguagecenter.com

## Processing activities

| # | Activity | Data subjects | Categories | Purpose | Legal basis | Retention | Recipients |
|---|---|---|---|---|---|---|---|
| 1 | Account management | Learners, admins | Name, email, role, track | Provide service | Contract | Life of account | Clerk, Neon |
| 2 | Practice + grading | Learners | Answers, band scores, feedback | Deliver IELTS prep | Contract / legit. interest | Life of account | OpenRouter, Anthropic, OpenAI, Neon |
| 3 | Speaking recording | Learners | Voice audio, transcripts (sensitive) | Speaking assessment | Consent | 90 days (default) | Cloudflare R2, OpenAI |
| 4 | Product analytics | All users | Usage events, user id | Improve product | Consent | Per analytics vendor | PostHog, Sentry |
| 5 | Billing | Admins, subscribers | Billing metadata, email | Take payment | Contract / legal obligation | Per tax law | Stripe |
| 6 | Email | Learners, admins | Name, email | Service + opt-in marketing | Contract / consent | Life of account | Resend |
| 7 | Consent + rights records | All users | Consent ledger, DSR requests, IP hash | Demonstrate compliance | Legal obligation | As long as needed for proof | Neon |

## Security measures

Encryption in transit; per-tenant `org_id` isolation enforced by `withOrg` +
the CI tenancy fuzzer; signed 15-minute URLs for recordings (raw keys never
exposed); salted IP hashing; least-privilege staff access; soft-delete + hard
erasure paths.

## International transfers

Primary hosting in Sydney, AU. Transfers subject to GDPR/UK rules rely on SCCs
+ the UK Addendum, or adequacy where applicable.

## Change log

- 2026-06-01 — Initial ROPA (ADR-0019).
