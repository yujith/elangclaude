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

Set up packages/db with Prisma, the schema from docs/ARCHITECTURE.md, and the withOrg() proxy from .claude/skills/multi-tenant-prisma/SKILL.md. Also write the tenancy fuzzer test. Use Neon dev branch for local Postgres.
```

Plan first. Then run.

## 7. After both are green: commit, then run /ship-feature

```bash
git add -A
git commit -m "chore: project scaffold with Next.js shell and Prisma tenancy"
```

Then in Claude Code: `/ship-feature` to verify everything passes the gate.

## 8. Now you're ready to build features

From here, every feature follows the loop:

1. `/plan-feature` (in plan mode)
2. Review/edit plan
3. `/clear` and execute the plan in a fresh session
4. `/audit-tenancy` if you touched the DB
5. `/ship-feature` before merge
6. Commit at least once per hour

## Common questions

**"Should I use Claude Code or Cursor for this edit?"**
Claude Code for anything multi-file or needing planning. Cursor for "rename this variable" or "show me what this function does". If you find yourself writing prose-length prompts in Cursor, switch to Claude Code.

**"Should I install all the skills I see in the best-practices repo?"**
No. Skills are like dependencies — every one you add is context Claude has to scan. Add only what you'll use this month. The four skills already in `.claude/skills/` are the ones tailored to this project.

**"What if the model wants to do something against the rules?"**
Rules win. The `<important if="...">` tags in `CLAUDE.md` are not suggestions. If Claude tries to bypass them, push back with "you're violating the rule in CLAUDE.md about X". If it keeps trying, that's a sign the rule needs sharpening — update it.

**"How do I keep CLAUDE.md from going stale?"**
Boris's rule: any developer should be able to launch Claude Code, say "run the tests", and it works. If it doesn't, the file is stale. Update the commands at the top whenever they change.
