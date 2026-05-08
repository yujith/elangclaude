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
| Primary accent | `--brand-red` | `#E63027` | CTAs, focus, highlights |
| Hover/active | `--brand-red-dark` | `#C2231A` | Hover state of red CTAs |
| Soft tint | `--brand-red-soft` | `#FDEAE8` | Alert/notification backgrounds |
| Primary surface | `--brand-black` | `#0A0A0A` | Hero, dark mode backgrounds |
| Light surface | `--brand-white` | `#FFFFFF` | Body backgrounds |
| Greys | `--brand-grey-{50–900}` | various | Borders, dividers, secondary text |

> ⚠️ The exact red hex was not numerically specified in the source PDF. `#E63027` is a visual match. **Confirm with the original Figma/Illustrator file before launch** and update the token files in lockstep.

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
