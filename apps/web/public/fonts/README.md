# Rubik woff2 fonts

Drop the three Rubik weights here for self-hosted brand typography. The `@font-face` declarations in `apps/web/app/globals.css` reference these exact filenames:

```
rubik-medium.woff2            # weight 500, normal
rubik-bold.woff2              # weight 700, normal
rubik-extrabold-italic.woff2  # weight 700, italic — the display weight
```

## Where to source them

Use [google-webfonts-helper](https://gwfh.mranftl.com/fonts/rubik) → pick weights `500`, `700`, `700italic` → Modern Browsers → download → unzip → rename the three woff2 files to match the names above.

Until these files land, the homepage falls back to `system-ui` per `--brand-font-*` in `packages/ui/src/tokens.css`. Hero typography will look wrong (no Extra Bold Italic) but pages will render.

## License

Rubik is licensed under the SIL Open Font License v1.1 — free for commercial use. The license text travels with the font in the Google Fonts download.
