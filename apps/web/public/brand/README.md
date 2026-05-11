# Brand assets

Cropped from `docs/Logo-0{1,2,3}.svg` (originals on a 1920×1080 canvas with the
artwork in the top-left). The files here have a tight `viewBox` so they render
at sensible intrinsic sizes.

```
logo-color.svg          # black wordmark + black icon + red-outlined accent rect — for light backgrounds
logo-on-dark.svg        # white wordmark + white icon + red-outlined accent rect — for the black hero / nav / footer
icon.svg                # checkered grid icon only (4 squares), uses fill="currentColor"
```

The third source variant (`docs/Logo-03.svg` — white-on-dark with a black
outline accent) is reserved for limited single-tone print environments and is
not currently exported here. Add it as `logo-mono-on-dark.svg` if a surface
needs it.

The icon is `fill="currentColor"` so it inherits text color. Set color in CSS
(e.g. `text-brand-red`, `text-white`) on the parent element.

See `.claude/skills/brand-system/SKILL.md` and `docs/BRAND.md` for clear-space
and contrast rules — never alter proportions, colors, or add effects.

## TODO

- [ ] `apps/web/app/favicon.ico` is still the Next.js default (purple "N").
      Replace with a brand-red 32×32 ICO derived from `icon.svg`. Modern
      browsers already pick up `apps/web/app/icon.svg` so the regression is
      cosmetic for legacy browsers only.
- [ ] Generate `apps/web/app/apple-icon.png` (180×180) for iOS "Add to Home
      Screen" once we have an image-processing toolchain.
