# Rubik woff2 fonts

Self-hosted from Google Fonts (SIL OFL). Two files cover the brand:

```
rubik-variable.woff2      # variable upright — covers Medium 500 and Bold 700
rubik-italic-bold.woff2   # static italic 700 — the display weight (Extra Bold Italic)
```

Google Fonts serves the same variable woff2 for both 500 and 700 upright, so we
declare a single `@font-face` with `font-weight: 100 900` in `apps/web/app/globals.css`
and the browser instances the right weight at render time.

## Refreshing

If the font version changes, re-fetch with a modern Chrome User-Agent so the
CSS endpoint returns woff2 (not legacy woff):

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
  (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
curl -sL -A "$UA" \
  "https://fonts.googleapis.com/css2?family=Rubik:ital,wght@0,500;0,700;1,700&display=swap"
```

The latin-subset URL ending in `…iJWKBXyIfDnIV7nBrXyw023e.woff2` is the upright
variable; the italic 700 latin URL ends in `…FHU3f4LnlY1PK6w.woff2`.

## License

Rubik is licensed under the SIL Open Font License v1.1 — free for commercial
use. The license text travels with the font in the Google Fonts download.
