# eLanguage Center — Brand Reference

Source: `Brand_Guidelines.pdf` (originals from SpaceRo, Chaska, MN). This document is the human-readable companion to `.claude/skills/brand-system/SKILL.md` and `.claude/rules/brand.md`.

## Identity

**Name:** eLanguage Center
**Tagline:** Skills That Open Doorways
**Promise:** Free. Fun. Effective.

## Logo

Wordmark "eLanguage Center" + checkered grid icon + red accent rectangle.

**Variants:**
- Full color (preferred default)
- White-on-black (dark heroes, photography backdrops)
- Black-on-white (light surfaces, print)
- Monochromatic black or white (limited B/W environments only — never mix B/W with color)

**Clear space:** equal on all sides, minimum equal to the height of the "e" in "eLanguage".

**Don't:** distort proportions, recolor, add effects, place on busy photography without a contrast plate.

## Colors

| Role | Token | Hex | Use |
|---|---|---|---|
| Primary accent | `--brand-red` | `#EE2346` | CTAs, focus, highlights |
| Hover/active | `--brand-red-dark` | `#CC1239` | Hover state of red CTAs |
| Soft tint | `--brand-red-soft` | `#FDE8EC` | Alert/notification backgrounds |
| Primary surface | `--brand-black` | `#0A0A0A` | Hero, dark mode backgrounds |
| Light surface | `--brand-white` | `#FFFFFF` | Body backgrounds |
| Greys | `--brand-grey-{50–900}` | various | Borders, dividers, secondary text |

Brand red is `#EE2346`, sourced from the SVG logos at `docs/Logo-0{1,2,3}.svg`
(`stroke="#ee2346"`). An earlier `#E63027` placeholder has been retired. When
changing the red, update `packages/ui/src/tokens.css`, `.claude/rules/brand.md`,
and `.claude/skills/brand-system/SKILL.md` in lockstep with this table.

## Typography

**Rubik** is the only typeface. Used in three weights:

- **Extra Bold Italic (700i)** — display only. Hero headlines, marketing splashes.
- **Bold (700)** — headlines, button labels, section titles.
- **Medium (500)** — body, UI labels, microcopy.

Rubik is free (Google Fonts). Self-host the woff2 files for performance:

```
apps/web/public/fonts/
  rubik-medium.woff2
  rubik-bold.woff2
  rubik-extrabold-italic.woff2
```

## Voice

**Free. Fun. Effective.** Confident teacher who actually likes their students.

- Active over passive. "You raised your Coherence band" beats "Coherence band has been raised".
- Specifics over slogans. "Your Lexical Resource went from 5.5 to 6.5 in 4 weeks" beats "You're improving!".
- Warmth without saccharine. "Nice work — your Task 2 paragraphing is much tighter" beats "🎉 Amazing job superstar! 🎉".

## Mockup references (from `Brand_Guidelines.pdf`)

The PDF contains finished mockups to use as visual anchors:
- **Business card** — black face with full-color logo, white reverse with red-outlined name pill and grey corner glyph.
- **Letterhead + envelope** — white letterhead with logo top-left, red-outlined headline pill, red footer band. Envelope: white outside with logo and address; red flap inside.
- **Website hero** — full-bleed dark photography with the wordmark top-left, "SKILLS THAT OPEN DOORWAYS" in white display type, "FREE . FUN . EFFECTIVE" tagline, red-outlined "REGISTER NOW" pill button, top nav with red-outlined active item indicator.

When designing new surfaces, return to these mockups for proportion, density, and rhythm.

## Application priorities

Print/digital surfaces, in order of brand prominence:
1. Marketing site hero
2. Onboarding/welcome emails
3. Dashboard hero strip
4. Test-result feedback page
5. Admin console
6. Internal/SuperAdmin tooling (least visible — function over polish)

## Org custom branding (ADR-0023)

Customer orgs may white-label the learner + org-admin surfaces: one accent,
one dark surface, a font from the vetted SIL-OFL allowlist, and a raster
logo (always shown on a white plate in dark chrome). Derived shades and
WCAG contrast gates are enforced in `packages/db/src/branding.ts` — themes
that would be unreadable cannot be saved. Platform surfaces (marketing,
legal, sign-in, SuperAdmin console, emails, Stripe) always keep the
eLanguage Center brand on this page's terms.

Contrast note (caught by the ADR-0023 axe gate): `#EE2346` on white is
4.23:1 — passes for large/bold text and UI components (≥3:1), fails AA for
small text. Use `--brand-red-dark` (`#CC1239`) for red text under ~19px on
light backgrounds.
