# ADR 0019 — PWA: hand-rolled service worker over Serwist/next-pwa

- Date: 2026-05-31
- Status: Accepted (implemented)

## Context

MVP v1 calls for the app to be "Web responsive, PWA-ready"
(`docs/ROADMAP.md`). Before this change `apps/web/public/` held only
brand + font assets — no web app manifest, no icons, no service worker.
The app was not installable and had no offline behaviour.

"PWA-ready" for v1 means: installable (valid manifest + icon set + theme/
viewport metadata) and resilient to a dropped connection (a branded
offline page instead of the browser error). It explicitly does **not**
mean offline access to test content, attempts, or grades — that is
Phase 2+ and is deliberately out of scope here.

The architecture rules (`.claude/rules/architecture.md`) lock the stack
and require an ADR before adding tooling. The obvious candidates were
`next-pwa` and its maintained App-Router successor **Serwist** (both
Workbox-based).

## Decision

**Generate icons at request time with Next's built-in `ImageResponse`,
and ship a small hand-rolled service worker instead of adding Serwist or
next-pwa.**

### Icons

No `sharp`/ImageMagick/rsvg is available in the toolchain, so we cannot
pre-rasterize PNGs. Instead the brand checker mark is reconstructed with
positioned divs in `lib/pwa/brand-icon.tsx` and rendered to PNG by
`ImageResponse` (Satori) via:

- `app/icon.tsx`, `app/apple-icon.tsx` — file-based metadata icons.
- `app/icons/{icon-192,icon-512,maskable-512}/route.tsx` — manifest
  icons, `force-static` so they prerender as cacheable assets.
- `app/manifest.ts` — file-based manifest, auto-linked by Next.

### Service worker

`public/sw.js` is plain JS (served at root scope `/`), registered by
`components/pwa/service-worker-registration.tsx` in production only
(dev would cache ephemeral chunks). Strategy:

- **cache-first** for public static assets (`/_next/static/`, `/fonts/`,
  `/brand/`, `/icons/`, `/manifest.webmanifest`).
- **network-first** for navigations, falling back to a precached
  `/offline` page. Navigation HTML is **never stored**.
- **network-only** (cache nothing) for everything else: all `/api/*`,
  every non-GET (server actions/mutations), all cross-origin (Clerk,
  OpenAI, Stripe, R2, PostHog), and same-origin RSC/data fetches.

## Why not Serwist / next-pwa

1. **Tenant isolation is the hard rule.** A cache is a cache key
   (`.claude/rules/multi-tenancy.md`): a learner from Org A must never be
   served Org B's data from a stale cache. Workbox-based tools precache
   the entire build manifest and lean on broad runtime-caching recipes;
   getting them to *never* cache authenticated HTML/RSC is config-heavy
   and easy to regress silently. A ~120-line worker with one
   `cacheStrategy()` function is fully auditable and unit-testable.
2. **Zero new stack tooling** — no Next 16 build-plugin integration to
   keep working across upgrades (Next/Tailwind plugin churn is already a
   theme here; see ADR-0001).
3. **Single source of truth.** `cacheStrategy()` is exported on `self`
   and driven directly by `lib/pwa/cache-policy.test.ts`, which asserts
   `/api/*`, navigations, and cross-origin requests are never cached.
   Loosening the policy fails CI.

This reverses the Serwist recommendation made during planning; the
tenant-isolation auditability argument won once implementation made the
Workbox caching surface concrete.

## Consequences

### Good

- Installable on Chrome/Edge/Android; iOS via Add to Home Screen with a
  correct apple-icon/title.
- Offline navigations show a branded page; static shell keeps working.
- No tenant data can enter any cache, enforced by an automated test.
- No new runtime/build dependency.

### Bad / watch

- We own the worker. Workbox features (precise precache revisioning,
  background sync) are not free — but they are out of v1 scope anyway.
- Cache invalidation on deploy relies on bumping `CACHE` in `sw.js` plus
  the skip-waiting/`controllerchange` reload flow. Bump `CACHE` when the
  precached shell (`/offline`, fonts) changes.
- `next-pwa`/Serwist remain the right call if/when Phase 2 wants real
  offline test content or background sync — revisit then.

## Follow-up surfaced: brand-red CTA contrast (not fixed here)

Adding an axe gate on `/offline` surfaced a **latent, app-wide** WCAG AA
issue: white text on the primary brand red `#EE2346` is only **4.23:1**,
below the 4.5:1 required for normal-size text. The existing
`bg-brand-red text-white` CTA pattern (used in writing/speaking practice,
grading, billing, profile, signup, etc.) shares this. It hasn't tripped
CI because the currently axe-tested pages either render their red CTA
`disabled` (axe exempts disabled controls — e.g. the `/profile` save
button) or don't show an enabled red CTA at normal size.

The `/offline` "Try again" button uses `brand-red-dark` (#CC1239 →
5.66:1) as a **scoped** fix. The global pattern is intentionally left
unchanged — fixing it touches dozens of components and needs a
`brand-system` decision (darken the CTA token vs. mandate large text on
red). **Recommend a dedicated brand-system follow-up.**

## Out of scope (Phase 2+)

Offline access to practice content, background-sync answer submission,
push notifications, and a custom `beforeinstallprompt` install button.
