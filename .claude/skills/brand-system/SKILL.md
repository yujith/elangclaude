---
name: brand-system
description: Use this skill whenever designing or styling any UI surface — pages, components, emails, marketing pages, dashboards, or admin consoles. Covers the eLanguage Center color tokens, typography (Rubik), logo usage, voice/tone, the hero/section/CTA page rhythm, and the "do/don't" list distilled from Brand_Guidelines.pdf. Trigger on edits in `apps/web/`, `packages/ui/`, any Tailwind config, or anywhere a hex code, font-family, or component primitive is being added or changed. Do not introduce a new color or font without consulting this skill first.
---

# Brand System Skill

## Tokens (canonical)

```css
/* packages/ui/src/tokens.css */
:root {
  --brand-red:        #EE2346;
  --brand-red-dark:   #CC1239;   /* hover/active */
  --brand-red-soft:   #FDE8EC;   /* tinted backgrounds, alerts */

  --brand-black:      #0A0A0A;
  --brand-grey-50:    #F5F5F5;
  --brand-grey-100:   #EFEFEF;
  --brand-grey-200:   #E5E5E5;
  --brand-grey-400:   #A3A3A3;
  --brand-grey-500:   #737373;
  --brand-grey-700:   #404040;
  --brand-grey-900:   #171717;
  --brand-white:      #FFFFFF;

  --font-display:     "Rubik", system-ui, sans-serif;   /* 700i */
  --font-heading:     "Rubik", system-ui, sans-serif;   /* 700  */
  --font-body:        "Rubik", system-ui, sans-serif;   /* 500  */

  --radius-sm:        6px;
  --radius-md:        10px;
  --radius-lg:        16px;
  --radius-pill:      999px;
}
```

Brand red is `#EE2346`, sourced from the design SVG logos in `docs/Logo-0{1,2,3}.svg`. An earlier `#E63027` placeholder has been retired — when changing the red, update `packages/ui/src/tokens.css`, `docs/BRAND.md`, `.claude/rules/brand.md`, and this file in lockstep.

## Tailwind config

```ts
// apps/web/tailwind.config.ts — extend, don't replace
theme: {
  extend: {
    colors: {
      brand: {
        red: "var(--brand-red)",
        "red-dark": "var(--brand-red-dark)",
        "red-soft": "var(--brand-red-soft)",
        black: "var(--brand-black)",
      },
      // grey scale exposed as `brand-grey-*`
    },
    fontFamily: {
      display: ["var(--font-display)"],
      heading: ["var(--font-heading)"],
      body: ["var(--font-body)"],
    },
  },
},
```

## Typography scale

| Use | Class | Size / Weight |
|---|---|---|
| Page hero | `font-display italic font-bold` | 60–96px |
| Section headline | `font-heading font-bold` | 36–48px |
| Card title | `font-heading font-bold` | 20–24px |
| Body | `font-body font-medium` | 16px |
| Small / metadata | `font-body font-medium` | 14px |
| Microcopy / disclaimer | `font-body font-medium` | 12px |

Line height: 1.1 for display, 1.25 for headings, 1.5 for body.

## The page rhythm

The brand reads cleanest when pages alternate:

1. **Black hero** with display type and a single red CTA pill (rounded-full, white text on `--brand-red`, hover → `--brand-red-dark`).
2. **White section** with structured content, cards on `--brand-grey-50` if needed.
3. **Black accent strip** for testimonials or stats.
4. **Footer** on `--brand-black` with red dividers.

Reference: the website mockup in `Brand_Guidelines.pdf` — "SKILLS THAT OPEN DOORWAYS" hero with "REGISTER NOW" red-outlined pill button, dark photography backdrop, white wordmark top-left.

## CTA pattern

```tsx
<button className="
  inline-flex items-center gap-2
  px-6 py-3 rounded-full
  bg-brand-red hover:bg-brand-red-dark
  text-white font-heading font-bold
  border border-brand-red
  transition-colors
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2
">
  Register Now
</button>
```

For secondary CTAs on dark backgrounds, use the **outlined** variant: transparent fill, red border, white text. (See the website hero in `Brand_Guidelines.pdf`.)

## Loading & busy states

Anything that waits on a server action, an external API (Clerk, Stripe, the AI
gateway, R2), or a long job MUST show a visible "working" cue. Don't hand-roll a
spinner — use the shared primitives in `apps/web/components/ui/`:

- **`Spinner`** — the only loading indicator. A brand-red arc (`border-t-brand-red`)
  on a `brand-grey-200` track, `animate-spin`, with `motion-reduce:animate-none`
  and a `role="status"` label. Sizes `sm | md | lg`. Pass `decorative` when it
  sits next to its own visible text. Never introduce a second spinner style or a
  non-red indicator.
- **`SubmitButton`** — drop-in for `<button type="submit">` inside a Server-Action
  `<form action={fn}>`. Reads `useFormStatus`, so it auto-disables + shows the
  Spinner while the action runs. Keep the button's existing brand classes; add
  `pendingLabel` (e.g. `"Generating…"`, `"Saving…"`) and the
  `disabled:opacity-60 disabled:cursor-not-allowed` pair.
- **`PendingButton`** — same look, but the caller passes `pending` (for
  `useTransition` / client `fetch` flows where `useFormStatus` doesn't apply).

Rule of thumb: a bare `<button type="submit">` inside `action={…}` is a bug —
it gives the user no feedback during the round-trip. (Exceptions: GET/filter
forms and buttons wired via the `form=` attribute outside their form, where
`useFormStatus` can't report pending.)

## Logo

- Wordmark "eLanguage Center" + checkered grid icon + red accent rectangle.
- Asset files live in `apps/web/public/brand/` (svg + png exports at 1x/2x/3x).
- Clear space = height of the "e" in "eLanguage" on all four sides, minimum.
- Variants: full-color (default), white-on-black (dark hero), black-on-white (light surfaces), monochromatic black or white only (limited B/W environments).

## Voice & tone

**Free. Fun. Effective.**

- **Free** as in joyful and unconstrained — not as in "no charge". Don't lean into the financial reading except in marketing where it fits.
- **Fun** — don't be stiff. "You smashed Reading today" beats "Reading attempt completed."
- **Effective** — back claims with specifics. "Your Coherence band rose from 5.5 to 6.5 in 4 weeks" beats "You're improving."

Avoid: corporate banking voice, ed-tech kindergarten voice, Silicon Valley bro voice. Aim for: confident teacher who actually likes their students.

## Org custom branding (ADR-0023)

Customer orgs may retone the `(learner)` and `(admin)` surfaces via
`OrgBranding` (accent + dark surface + vetted font). Mechanics: a
CSS-variable override (`--brand-red`, `--brand-black`, `--brand-font-*`)
inlined on the role layout's root div — never `:root` — so every
`bg-brand-red`-style utility retones automatically and platform surfaces
stay locked. When building org-scoped UI, keep using the brand utilities;
NEVER hardcode `#EE2346`/`#0A0A0A` hexes in JSX, or the surface won't theme.
Derived shades and WCAG gates live in `packages/db/src/branding.ts`; org
fonts are self-hosted in `apps/web/public/fonts/` (allowlist only, SVG logos
refused). The platform defaults below still govern everything else.

## Quick checklist before shipping any new surface

- [ ] Only red, black, white, and the grey scale used.
- [ ] Only Rubik used.
- [ ] One primary CTA per view (red pill).
- [ ] Logo with proper clear space.
- [ ] Body type ≥ 16px, line-height 1.5.
- [ ] Focus rings visible on all interactive elements (`focus-visible:ring-brand-red`).
- [ ] Contrast checked: white on black ≥ 4.5:1, never red on red. **Red on
      white is 4.23:1** — fine for large/bold text and components (≥3:1),
      but use `--brand-red-dark` for red text under ~19px on light
      backgrounds (the old "red on white ≥ 4.5" line here was wrong; an axe
      gate caught it — ADR-0023).
- [ ] Tested at 320px, 768px, 1280px, 1920px viewports.

## Don't

- ❌ Add a "success green" or "warning amber". Use red + neutrals + iconography to convey state.
- ❌ Use red for body text or large flat backgrounds — it's an accent, not a surface.
- ❌ Use Rubik Italic anywhere except the display weight.
- ❌ Place the wordmark on a busy photo without a black plate.
- ❌ Substitute Inter or system fonts because Rubik isn't loading — fix the font load instead.
