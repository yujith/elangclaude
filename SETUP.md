# Setup — your first 60 minutes

Follow this in order. Don't skip ahead.

## 0. Tooling decision (5 min)

You currently have five AI tools open. **Close all but two:**

- **Keep open:** Claude Code (your terminal driver).
- **Keep open:** Cursor (or Windsurf — pick one). Use it as a viewer + occasional inline edit. Do **not** run its agent on the same files Claude Code is touching.
- **Close:** the other three. Reopen Codex CLI later, *only* for cross-model plan reviews.

## 1. Move this starter into place (5 min)

Drop the contents of this `elanguage-center/` directory into your local project folder. Verify the layout:

```
elanguage-center/
├── CLAUDE.md
├── README.md
├── SETUP.md                  ← you are here
├── .claude/
│   ├── settings.json
│   ├── rules/{architecture,multi-tenancy,ai-cost-control,brand}.md
│   ├── commands/{plan-feature,audit-tenancy,ship-feature}.md
│   ├── agents/{architect,tenant-isolation-auditor}.md
│   └── skills/{ielts-domain,multi-tenant-prisma,brand-system,ai-grading}/SKILL.md
├── docs/{BRAND,ARCHITECTURE,ROADMAP}.md
└── .mcp.json
```

Drop your `Brand_Guidelines.pdf` and the build brief into `docs/` so Claude Code can read them directly: rename the brief to `docs/BRIEF.md` (Claude reads markdown faster than PDF).

## 2. Install Claude Code (5 min)

```bash
# macOS / Linux:
curl -fsSL https://claude.ai/install.sh | bash

# or via npm:
npm install -g @anthropic-ai/claude-code
```

Then `cd elanguage-center && claude` to start your first session. It will read `CLAUDE.md` and the `.claude/rules/` files automatically.

> Verify the install command above against the latest docs at https://docs.claude.com — the script URL or package name may have shifted since this file was written.

## 3. Clone the best-practices repo as reference (5 min)

```bash
# Somewhere outside your project:
git clone https://github.com/shanraisshan/claude-code-best-practice ~/refs/claude-best-practice
```

This is **a reference**, not an installable package. The patterns we've already lifted into your `.claude/` folder come from this repo. When you want to add a new agent / command / skill / hook later, browse this repo for templates first. The `tips/` and `best-practice/` directories are particularly worth bookmarking.

Don't copy the whole thing into your project. Cherry-pick.

## 4. Install the official Anthropic skills (10 min)

These are the production-grade skills (docx, pdf, pptx, xlsx, frontend-design, etc.) maintained by Anthropic:

```bash
# Browse what's available:
open https://github.com/anthropics/skills

# Or clone and selectively copy any you'll use:
git clone https://github.com/anthropics/skills ~/refs/anthropic-skills
```

For this project specifically, the most useful are:
- `frontend-design` — auto-loads when Claude touches React/Tailwind
- `pdf` — for ingesting PDFs (you have `Brand_Guidelines.pdf`)

To install one into your project: copy its directory into `.claude/skills/<name>/`. Keep its `SKILL.md` intact.

## 5. Scaffold the Next.js app (15 min)

In a fresh Claude Code session:

```
> /plan-feature

I want to scaffold the apps/web Next.js 14 app with TypeScript, Tailwind, shadcn/ui, the brand tokens from .claude/skills/brand-system/SKILL.md, and a placeholder homepage that mirrors the website mockup in docs/BRAND.md (dark hero, "SKILLS THAT OPEN DOORWAYS", red REGISTER NOW pill button). Don't add auth or DB yet — just the static shell.
```

Claude will produce a phase-wise plan. Read it, push back where it's wrong, then say "go". Use plan mode (`shift+tab` twice) the entire time.

## 6. Set up the database next (15 min)

In a new Claude Code session (`/clear` first):

```
> /plan-feature

Set up packages/db with Prisma, the schema from docs/ARCHITECTURE.md, and the withOrg() proxy from .claude/skills/multi-tenant-prisma/SKILL.md. Also write the tenancy fuzzer test. Use Neon dev branch for local Postgres; add a separate Neon test branch and (optionally) a Neon child branch — see `packages/db/README.md` and `DATABASE_URL_NEON_CHILD` in `packages/db/.env.example`.
```

Plan first. Then run.

## 7. After both are green: commit, then run /ship-feature

```bash
git add -A
git commit -m "chore: project scaffold with Next.js shell and Prisma tenancy"
```

Then in Claude Code: `/ship-feature` to verify everything passes the gate.

> **Status note (2026-05-09):** Steps 5 and 6 are both done — `apps/web` runs on Next 16 + Tailwind 4 (see `docs/adr/0001-next16-tailwind4.md`), and `packages/db` is wired with the canonical schema, the `withOrg()` proxy, the tenancy fuzzer, and a 2-org seed (see `docs/adr/0002-neon-test-branch-for-fuzzer.md` and `packages/db/README.md`). The next session targets the auth + AI gateway scaffold.

## 8. Now you're ready to build features

From here, every feature follows the loop:

1. `/plan-feature` (in plan mode)
2. Review/edit plan
3. `/clear` and execute the plan in a fresh session
4. `/audit-tenancy` if you touched the DB
5. `/ship-feature` before merge
6. Commit at least once per hour

## 9. Wire Clerk auth (10 min, once per fresh clone)

Clerk is the canonical auth backend in both dev and production. The dev-only `/dev/login` seeded-user switcher still works locally; it's just a fallback for the e2e suite and quick role-swapping.

### Keys

In **dashboard.clerk.com** → your app → **API keys**, copy the publishable + secret keys into `packages/db/.env` (the shared local secret store — `apps/web/next.config.ts` loads it into `process.env`):

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL="/post-signin"
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL="/post-signin"
```

`/post-signin` is a server-side trampoline that loads the user's role from our DB and forwards them to the right home (`/orgs` for SuperAdmin, `/admin` for OrgAdmin, `/practice/writing` for Learner). The Clerk components also hard-code this fallback as a prop, so the env var is just a safety net.

### Webhook (local dev via ngrok)

The webhook at `/api/clerk/webhook` syncs Clerk orgs / users / memberships into our `Organization` and `User` tables. For local dev:

```bash
# In a separate terminal:
ngrok http 3000
```

Then in **dashboard.clerk.com** → **Webhooks** → **Add endpoint**:

- URL: `https://<your-ngrok-subdomain>.ngrok-free.app/api/clerk/webhook`
- Subscribe to: `user.*`, `organization.*`, `organizationMembership.*`
- Copy the **Signing Secret** (`whsec_...`) into `packages/db/.env`:

```
CLERK_WEBHOOK_SIGNING_SECRET="whsec_..."
```

### Linking a seeded user to your Clerk account

The seed script creates `super@elanguage.dev` plus org admins + learners. With `CLERK_SECRET_KEY` set, `pnpm db:seed` also creates each as a Clerk user with the shared dev password `elanguagecenter2026!` (overridable via `SEED_DEFAULT_PASSWORD`), so you can sign in immediately at `/sign-in`. To opt out of the Clerk side of seeding for offline dev, run `SEED_SKIP_CLERK=1 pnpm db:seed`.

If you'd rather link your own Clerk account to a seeded row instead of using the shared password:

1. Visit `/sign-up`, register with the **same email** as the seeded user (e.g. `super@elanguage.dev` → owned by SuperAdmin).
2. Verify the email through Clerk's flow.
3. First authenticated request lazy-links your Clerk user ID onto the seeded DB row (matched by email); subsequent requests hit the fast path.

> Domain note: we use `.dev` (not `.test`) for seed fixtures because Clerk's Backend API rejects RFC 2606 reserved TLDs (`.test`, `.example`, `.invalid`, `.localhost`) with `form_param_format_invalid`. `.dev` is a real ICANN TLD; the inboxes don't exist and don't matter — the seed sets a password rather than sending an invitation.

If you prefer not to use a Clerk account at all locally, hit `/dev/login` — it still sets the dev-session cookie for any seeded user and bypasses Clerk entirely. `/dev/login` is hidden in production.

### Production note

In production every consumer (`requireOrgContext`, the webhook, the dev-login server action) refuses to fall back to the dev-session cookie. Clerk is the only allowed auth path.

## Common questions

**"Should I use Claude Code or Cursor for this edit?"**
Claude Code for anything multi-file or needing planning. Cursor for "rename this variable" or "show me what this function does". If you find yourself writing prose-length prompts in Cursor, switch to Claude Code.

**"Should I install all the skills I see in the best-practices repo?"**
No. Skills are like dependencies — every one you add is context Claude has to scan. Add only what you'll use this month. The four skills already in `.claude/skills/` are the ones tailored to this project.

**"What if the model wants to do something against the rules?"**
Rules win. The `<important if="...">` tags in `CLAUDE.md` are not suggestions. If Claude tries to bypass them, push back with "you're violating the rule in CLAUDE.md about X". If it keeps trying, that's a sign the rule needs sharpening — update it.

**"How do I keep CLAUDE.md from going stale?"**
Boris's rule: any developer should be able to launch Claude Code, say "run the tests", and it works. If it doesn't, the file is stale. Update the commands at the top whenever they change.
