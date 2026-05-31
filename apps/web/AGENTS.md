<!-- BEGIN:nextjs-agent-rules -->
# Working in `apps/web`

This app runs on **Next.js 16 + React 19 + Tailwind 4**. Conventions differ from older versions and from much training data — confirm against the actual installed packages or the official docs at https://nextjs.org/docs and https://tailwindcss.com/docs before writing code based on memory.

Project-specific notes (see also `docs/adr/0001-next16-tailwind4.md` and the root `CLAUDE.md`):

- **No `tailwind.config.ts`.** Design tokens live in CSS via `@theme` blocks. See `app/globals.css` and `packages/ui/src/tokens.css`.
- **Brand utilities** (`bg-brand-red`, `font-display`, `rounded-pill`, etc.) come from `@elc/ui/tokens.css`. New brand tokens go in `packages/ui/src/tokens.css` first, then become utilities automatically.
- **Server Components by default.** Add `"use client"` only when you need interactivity.
- **App Router.** All routes live in `app/`. Route groups use `(group-name)/` once we add them.
- **Role header chrome:** `(learner)/layout.tsx`, `(admin)/layout.tsx`, and `(super)/layout.tsx` intentionally share the same rhythm: logo + role cue on the left, then a right-aligned menu ending with Profile and Sign out. Keep these plain horizontal navs aligned unless the role chrome changes everywhere. See `docs/adr/0013-org-admin-dashboard-thin-slice.md` and `docs/adr/0015-learner-home-dashboard.md`.

The multi-tenancy, AI cost, and brand rules in `.claude/rules/*.md` apply here too.
<!-- END:nextjs-agent-rules -->
