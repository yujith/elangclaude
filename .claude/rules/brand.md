# Brand Rules

> Auto-loaded with every Claude Code session. Source of truth: `docs/BRAND.md`.

## Core tokens (locked)

```css
--brand-red:       #EE2346;   /* Primary accent — CTAs, highlights, focus rings */
--brand-black:     #0A0A0A;   /* Primary surface — hero, cards, dark mode bg */
--brand-white:     #FFFFFF;   /* Light surface */
--brand-grey-50:   #F5F5F5;
--brand-grey-200:  #E5E5E5;
--brand-grey-500:  #737373;
--brand-grey-900:  #171717;

--font-display:  "Rubik", sans-serif;  /* Extra Bold Italic, 700i */
--font-heading:  "Rubik", sans-serif;  /* Bold, 700 */
--font-body:     "Rubik", sans-serif;  /* Medium, 500 */
```

Brand red is `#EE2346`, taken from the source SVG logos in `docs/Logo-0{1,2,3}.svg`
(`stroke="#ee2346"`). An earlier `#E63027` placeholder has been retired — keep this
file, `packages/ui/src/tokens.css`, `docs/BRAND.md`, and `.claude/skills/brand-system/SKILL.md`
in lockstep when changing it.

## Voice

**Free. Fun. Effective.** Confident, accessible, not stuffy academic. Headlines are short and active ("Skills That Open Doorways"). Avoid IELTS jargon in marketing surfaces; use it precisely in product surfaces (band scores, criterion names).

## Logo usage (from Brand_Guidelines.pdf)

- Wordmark "eLanguage Center" + checkered grid icon + red accent rectangle.
- Two variants: full-color (preferred) and B/W (limited environments only).
- Maintain equal clear space on all sides — minimum equal to the height of the "e" in the wordmark.
- **Do not** alter colors, proportions, or add effects (drop shadow, gradient, outline).
- B/W version: monochromatic — symbol matches the wordmark color, never mixed.

## Org custom branding is the ONE sanctioned exception (ADR-0023)

Org-scoped surfaces (`(learner)` + `(admin)` layouts) may be retoned by a
customer org's `OrgBranding` row — accent, dark surface, and a font from the
vetted allowlist in `packages/db/src/branding.ts`. This works ONLY through
the CSS-variable override on the role layout's root div; the rules below
still bind every platform surface (marketing, legal, `(super)`, suspended,
emails) and all *default* styling. Never widen the exception: no arbitrary
CSS, no un-vetted fonts, no skipping `validateBranding()`.

Contrast correction from the ADR-0023 axe gate: brand red `#EE2346` on
white is **4.23:1** — fine for large/bold text and UI components (≥3:1),
but **14px red text on light backgrounds fails AA**. Use `--brand-red-dark`
(`#CC1239`, 5.7:1 on white) for small red text.

## Don't

- ❌ Introduce a new accent color. If a feature "needs" a green or blue, it doesn't — use the red sparingly and let neutrals do the work.
- ❌ Use a font other than Rubik. No Inter "just for the dashboard".
- ❌ Place the logo on a busy photographic background without a black or white plate behind it.
- ❌ Use red on red, or red on a saturated background. Red lives on black, white, or neutral grey.
- ❌ Use Rubik Italic for body copy — italic is reserved for the display weight.

## Do

- ✅ Use red for one primary CTA per view, focus rings, and active states.
- ✅ Black hero, white content, red CTA — that's the default page rhythm.
- ✅ Big type. Rubik Extra Bold Italic looks great at 60px+.
- ✅ Generous whitespace. Brand reads premium when uncrowded.

## When asked to design a new surface

1. Check `packages/ui/src/components` for an existing primitive.
2. If new, sketch in the brand: hero/section/card pattern with the tokens above.
3. Run it past `docs/BRAND.md` mockups (business card, letterhead, website hero) for consistency.
4. Never import a non-brand component library — shadcn/ui only, restyled to brand.
