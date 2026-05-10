# Brand assets

Drop the wordmark + icon files here when they land from the design source. Expected files:

```
wordmark.svg              # full-color: black wordmark + red accent rectangle
wordmark-white.svg        # white-on-dark variant for the homepage hero
wordmark-mono-black.svg   # monochromatic black (limited B/W environments)
wordmark-mono-white.svg   # monochromatic white (limited B/W environments)
icon.svg                  # checkered grid icon, standalone
favicon.ico               # 32x32 / 16x16
```

Until these land, the app uses a text-only `<Wordmark />` component (`apps/web/components/wordmark.tsx`) as a placeholder.

See `.claude/skills/brand-system/SKILL.md` and `docs/BRAND.md` for clear-space and contrast rules — never alter proportions, colors, or add effects.
