# Roadmap

## MVP v1 — what ships first

All four IELTS sections (Reading, Listening, Writing, Speaking). Both Academic and General Training tracks, learner-selectable. Section practice and full timed mock tests. AI grading only — no human review yet. Conversational Speaking AI with recording storage. Org Admin dashboard with bulk learner invite (single email + CSV), seat usage, and activity log. SuperAdmin console for organization CRUD, quota configuration, AI cost dashboard, and content pool moderation. Per-user quota enforcement, server-side, atomic. Web responsive, PWA-ready (installable manifest + icons + offline shell shipped 2026-05-31 — see ADR-0019).

## Phase 2 — after MVP traction

The Reviewer/Teacher role with a human-grading workflow: recordings hit a queue, reviewers listen and can override the AI band score. Advanced org analytics with cohort charts and exportable CSV/PDF reports. SSO (SAML/Okta) — added when the first enterprise prospect requires it. Custom per-org branding (logo, colors). Self-service Stripe billing portal. Adaptive difficulty — the system recommends practice based on each learner's weak criteria. React Native mobile shell over the web app.

## Phase 3 and beyond

Languages and exams beyond English-IELTS — TOEFL, PTE, Cambridge. A live "AI tutor" 24/7 chat coach. Personalized study plans. Group/cohort features for classroom settings.

## Explicitly off the roadmap

Live human tutoring or classroom features. We're not competing with Italki or Cambly.

## Open questions to validate before scaling

Speaking AI cost per 10-minute session — model the worst case before signing larger orgs. AI grading defensibility — quarterly examiner re-grade audits, target MAE ≤ 0.5 bands. Audio storage cost — default 90-day retention, configurable per org, watch growth as we scale. Quota ergonomics mid-test — current behavior is "let them finish the current test, block new ones until reset" — revisit if support tickets pile up.
