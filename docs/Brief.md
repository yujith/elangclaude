# eLanguage Center — IELTS Prep SaaS

## Build Brief (v1.0)

> A B2B SaaS platform that organizations license in bulk to give their learners realistic, AI-powered IELTS practice across both Academic and General Training tracks.

---

## 1. Product Overview

eLanguage Center is a web-based IELTS preparation platform sold to organizations (language schools, migration agencies, universities, corporate L&D, the British Council, etc.) on a per-seat subscription model with usage quotas. Learners practice all four IELTS sections — Reading, Listening, Writing, and Speaking — through AI-generated tests with AI-driven grading. Speaking is delivered as an interactive voice conversation with an AI examiner. Recordings are stored so a human reviewer can later upgrade the AI grade if the org has purchased that tier.

**Tagline:** *Skills That Open Doorways — Free. Fun. Effective.*

---

## 2. Brand

- **Primary palette:** Red + Black (extract exact hex from brand assets — see `Brand_Guidelines.pdf`)
- **Secondary palette:** White + neutral greys
- **Typography:** Rubik (Extra Bold Italic for display, Bold for headlines, Medium for body)
- **Logo:** "eLanguage Center" wordmark with checkered grid icon + red accent rectangle
- **Voice:** Free, Fun, Effective — confident but accessible, not stuffy academic

---

## 3. Target & Positioning

| Dimension | Detail |
|---|---|
| **Buyer** | Org admin at a language school / migration agency / education provider |
| **End user** | Adult self-learner preparing for IELTS Academic or General Training |
| **Sales motion** | B2B subscription — orgs buy N seats with daily/monthly AI-call quotas |
| **Primary competitor space** | E2Language, Magoosh IELTS, IELTS Online Tests, IDP/BC official prep |
| **Differentiator** | Conversational AI Speaking examiner + clean B2B admin tooling + cost-controlled AI generation |

---

## 4. User Roles

| Role | Scope | Key Permissions |
|---|---|---|
| **Super Admin** (you) | Global | Manage organizations, set per-org quotas, monitor system health, manage content pool |
| **Org Admin** | Single organization | Invite/remove learners (single + bulk), view seat usage, view activity log, manage org settings |
| **Reviewer / Teacher** *(Phase 2)* | Assigned learners within an org | Receive grading queue items, listen to recordings, override AI band scores |
| **Learner** | Self | Take section practice + full mock tests, view their own results & progress, choose Academic vs General track |

---

## 5. Core User Journeys (MVP v1)

### 5.1 Org Admin
1. Receives onboarding email from Super Admin with org account credentials
2. Logs into admin dashboard
3. Invites learners via single email or bulk CSV upload (template provided)
4. Sees seat usage (X of Y seats active) + activity log (who's practiced what, when)
5. Manages license/billing details

### 5.2 Learner
1. Receives invite email → sets password → onboards
2. Selects IELTS track: **Academic** or **General Training** (changeable later in profile)
3. Lands on dashboard showing: recent activity, recommended next test, band score trend
4. Picks one of:
   - **Section Practice** (just Reading, Listening, Writing, or Speaking)
   - **Full Mock Test** (all 4 sections, timed, exam simulation)
5. Takes test → submits → AI grades → sees band score breakdown + feedback
6. Reviews results, drills down on weak areas, retakes or moves on

### 5.3 Super Admin
1. Onboards new organizations (creates org, sets seat count + quota limits)
2. Monitors AI generation cost dashboard
3. Manages global content pool (approves AI-generated tests before they enter rotation)
4. Reviews system health, error logs, model performance

---

## 6. Functional Requirements (MVP v1)

### 6.1 Authentication & Multi-Tenancy
- Email + password auth (magic link optional)
- Org-scoped data isolation (every query filtered by `org_id`)
- Role-based access control (Super Admin > Org Admin > Learner)
- Session management with refresh tokens
- Password reset flow

### 6.2 License & Quota Management
- Per-org seat limit (e.g. British Council = 100 seats)
- Per-user daily/monthly AI-call quota (configurable per org)
- Quota enforcement happens server-side before any AI call
- Graceful UX when quota hit ("Daily limit reached, resets at midnight UTC")

### 6.3 Test Content Engine
- **Caching strategy:** AI generates new tests only when the existing pool is exhausted for a given user (i.e. user has already attempted everything in the bank)
- New AI-generated tests enter the global pool and are reusable across all users/orgs
- Super Admin reviews/approves new tests before they go live (quality gate)
- Tests tagged by: track (Academic/General), section, difficulty, topic, IELTS question type

### 6.4 The Four Sections

**Reading**
- Passage + multiple question types (MCQ, T/F/NG, matching headings, sentence completion)
- 60-min timer (full mock) or untimed (practice mode)
- Auto-grading (deterministic, no AI needed for this)

**Listening**
- Audio playback (TTS-generated or curated)
- Same question types as Reading + form completion
- 30-min timer
- Auto-grading

**Writing**
- Task 1 (Academic: chart/graph; General: letter) + Task 2 (essay)
- 60-min timer
- AI grading on 4 IELTS criteria: Task Achievement, Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy
- Returns band score + criterion-level feedback + improvement suggestions

**Speaking**
- Interactive AI voice conversation simulating real IELTS Speaking examiner
- 3 parts: Introduction, Long Turn (cue card), Discussion
- Recording saved to object storage
- AI grading on 4 IELTS criteria: Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy, Pronunciation
- Recording retained for potential human upgrade (Phase 2)

### 6.5 Results & Progress (Learner View)
- Band score per section + overall
- Criterion-level breakdown for Writing/Speaking
- Trend chart over time
- Weak-area surfacing ("You consistently lose marks on coherence")
- History of all attempts

### 6.6 Org Admin Dashboard (MVP — keep basic)
- Seat utilization (active vs total)
- Activity log: learner | section | timestamp | band score
- Bulk invite tool (single email field + CSV upload)
- Org settings (name, contact, quota config display)

### 6.7 Super Admin Console
- Organization CRUD
- Quota configuration per org
- AI cost dashboard (daily/monthly spend per provider)
- Content pool moderation (approve/reject/edit AI-generated tests)
- System logs

---

## 7. Data Model (Initial)

```
Organization (id, name, seat_limit, quota_daily, quota_monthly, status)
  └── User (id, org_id, role, email, name, ielts_track, created_at)
         └── Attempt (id, user_id, test_id, section, started_at, submitted_at, status)
                └── Answer (id, attempt_id, question_id, response, is_correct)
                └── Grade (id, attempt_id, band_overall, criteria_scores_json, feedback_text, graded_by_ai_or_human)
                └── Recording (id, attempt_id, storage_url, duration_sec)  -- Speaking only

Test (id, track, section, difficulty, status, created_at, approved_by)
  └── Question (id, test_id, type, prompt, correct_answer, points)

QuotaUsage (id, user_id, date, ai_calls_count)
ActivityLog (id, org_id, user_id, action, metadata, timestamp)
```

---

## 8. AI Architecture

| Use Case | Provider/Model | Notes |
|---|---|---|
| Question generation (Reading, Listening, Writing prompts) | **OpenRouter** routing to cheap models (Llama 3, Gemini Flash, Mistral) | Bulk content generation; quality-checked by Super Admin |
| Audio generation for Listening | TTS (ElevenLabs / OpenAI TTS / Google) | Multiple accents per IELTS norms |
| Writing grading | **Claude API** (Sonnet/Opus class) | Stronger reasoning + rubric adherence |
| Speaking conversation (real-time) | **OpenAI Realtime API** *or* **ElevenLabs Conversational AI** | Voice-in/voice-out, low latency |
| Speaking grading | Whisper transcription → Claude scoring on transcript + audio features | Pronunciation/fluency from audio metrics |

**Cost controls:**
- Cache aggressively (generate once, serve many)
- Per-user quota gates before any LLM call
- Cheaper model tier for generation, premium tier for grading
- Log token usage per org for cost attribution

---

## 9. Tech Stack (Recommended)

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js 14+ (App Router) + TypeScript + Tailwind** | Fast iteration with AI builders, PWA-ready |
| UI Components | shadcn/ui + Rubik font + brand palette | Clean, ships fast |
| Backend | Next.js API routes (or separate Node/Fastify if scaling) | Single repo simplicity |
| Database | **PostgreSQL** + Prisma ORM | Strong relational fit for multi-tenant data |
| Auth | Clerk *or* Auth.js (NextAuth) | Handles orgs/multi-tenancy well |
| Object storage | Cloudflare R2 (cheap egress) or AWS S3 | For Speaking recordings + audio assets |
| Email | Resend or Postmark | Invite emails, password resets |
| Hosting | Vercel (frontend) + Supabase/Railway/Neon (Postgres) | Low ops, fast deploys |
| Realtime voice | OpenAI Realtime API (WebRTC) | Simplest viable path |
| LLM gateway | OpenRouter | Cost-optimized model routing |
| Monitoring | Sentry + PostHog | Errors + product analytics |

---

## 10. Non-Functional Requirements

- **Tenancy isolation:** every query and storage path scoped by `org_id`; never trust client-provided IDs
- **Quota enforcement:** server-side, atomic increment with transactional safety
- **Audio retention:** configurable per org (default 90 days)
- **GDPR readiness:** delete-user endpoint cascades to recordings, attempts, grades
- **Accessibility:** WCAG 2.1 AA — keyboard nav, screen reader, captions for Listening
- **Performance:** test load under 2s; recording upload resilient to network drops
- **Security:** rate limiting on auth endpoints, signed URLs for recordings, secrets never client-exposed

---

## 11. MVP v1 — IN Scope

✅ All 4 IELTS sections (Reading, Listening, Writing, Speaking)
✅ Both Academic + General Training tracks (user-selectable)
✅ Section practice + Full mock tests
✅ AI grading only (no human review yet)
✅ Conversational Speaking AI with recording storage
✅ Org Admin: bulk invite + seat usage + activity log
✅ Super Admin: org management + content pool moderation
✅ Per-user quota enforcement
✅ Web responsive + PWA

---

## 12. Explicitly OUT of MVP v1

❌ Reviewer/Teacher role + human grading workflow → **Phase 2**
❌ Native iOS/Android apps → **Phase 3**
❌ Languages other than English → **Phase 3+**
❌ SSO (SAML/Okta) → **Phase 2** when first enterprise customer asks
❌ Custom org branding/white-label → **Phase 2**
❌ Cohort analytics, exportable reports → **Phase 2**
❌ Live tutor/classroom features → not on roadmap
❌ Payment processing UI (handled offline / via invoice initially)

---

## 13. Phase 2 Roadmap (post-MVP)

- Reviewer role + human grade upgrade workflow (recording → reviewer queue → override band)
- Advanced org admin analytics (cohort charts, exportable CSV/PDF reports)
- SSO for enterprise
- Custom org branding (logo, colors)
- Self-service billing portal (Stripe)
- Adaptive difficulty (test recommendations based on weak areas)
- Mobile apps (React Native shell over web)

---

## 14. Phase 3+

- Languages beyond English (TOEFL, PTE, Cambridge)
- Live AI tutor (24/7 chat coach)
- Personalized study plans
- Group/cohort features for classroom use

---

## 15. Open Questions / Risks to Validate

1. **Speaking AI cost per session** — model a 10-minute conversation; if too high, fall back to record-and-grade
2. **AI grading defensibility** — band scores need to align with real IELTS examiners; benchmark against published sample answers
3. **Content quality** — Super Admin moderation is a bottleneck; consider tiered approval (auto-approve high-confidence generations)
4. **Audio storage costs** — recordings add up; default 90-day retention with org-configurable extension
5. **Rate limit ergonomics** — when a learner hits their daily AI quota mid-test, what happens? (suggested: complete current test, block new ones until reset)

---

## Appendix: Suggested Repo Structure

```
elanguage-center/
├── apps/
│   └── web/                    # Next.js app (frontend + API routes)
├── packages/
│   ├── db/                     # Prisma schema + migrations
│   ├── ai/                     # LLM clients, prompts, grading logic
│   └── ui/                     # Shared shadcn components
├── prompts/
│   ├── grading/writing.md
│   ├── grading/speaking.md
│   └── generation/{section}.md
└── docs/
    └── BRIEF.md                # this file
```
