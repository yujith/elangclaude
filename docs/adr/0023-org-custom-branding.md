# ADR-0023: Org custom branding (white-label theming)

> Status: Accepted · 2026-06-10

## Context

The Brief parks "Custom org branding (logo, colors)" in Phase 2, but B2B
buyers ask for it early: a language school wants its students to see *its*
brand, not ours. The product owner pulled it forward with three requirements:
curated flexibility (colours + logo + a vetted font list, not arbitrary CSS),
**bulletproof UI** (no org can configure an unreadable theme), and the
branding must flow through to learners.

Tension: `.claude/rules/brand.md` locks Rubik + red/black platform-wide
("never introduce a new color or font"). This ADR is the sanctioned
exception, with a fence around how far it goes.

Two pieces of prior art made the implementation small: Tailwind 4's
`@theme inline` in `packages/ui/src/tokens.css` resolves every brand utility
through `:root` CSS variables ("a future override of :root retones the whole
app" — written in anticipation of exactly this), and `packages/storage`
already had the org-prefixed-key + structural-guard pattern for tenant
objects.

## Decisions

### D1 — Curated theming: one accent, one dark surface, one allowlisted font

`OrgBranding` (1:1 with `Organization`, tenant-scoped, in
`TENANT_SCOPED_MODELS`) stores exactly `primary_color`,
`surface_dark_color`, `font_key`, and a logo key. Hover shades, soft tints,
and on-accent text colour are **derived** in `packages/db/src/branding.ts`
(`deriveBrandingPalette`) — orgs cannot hand-pick disharmonious or unreadable
derived states. Greys and radii stay platform-owned. No custom CSS, ever.

### D2 — WCAG gates make "bulletproof" structural, not advisory

`validateBranding()` rejects any save where: white text on the dark surface
< 4.5:1, accent on white < 3:1, accent on the dark surface < 3:1, or CTA text
on the accent < 3:1 (the 3:1 thresholds are WCAG 1.4.11 non-text /
large-bold-text levels — chosen because the platform's own `#EE2346` on
white is **4.23:1**, not the ≥4.5 the brand checklist used to claim). The
editor runs the same pure function for live preview warnings; the server
action re-runs it, so a devtools-tampered palette is re-rejected. The math
guarantees the better of white/black always clears ~4.58:1 on any accent, so
derived CTA text can never be unreadable.

### D3 — Theme delivery is a CSS-variable override on the role layout's root div

`(learner)/layout.tsx` and `(admin)/layout.tsx` inline-style their root div
with `--brand-red`, `--brand-red-dark`, `--brand-red-soft`, `--brand-black`,
and `--brand-font-*` overrides (plus re-declared `font-family`/`color`,
because descendants inherit *computed* values from `body`). Never `:root`,
never `<body>`: public/marketing/legal/`(super)`/suspended surfaces stay
platform-branded by construction. Unbranded orgs render byte-identical DOM
(the style attr is omitted). Resolution is `resolveBrandingTheme()`: missing
row, `enabled=false`, or a row that no longer validates (e.g. a retired font
key) all fall back to the platform default rather than rendering broken.

### D4 — Fonts: 9 self-hosted SIL-OFL faces, never a CDN

`BRANDING_FONTS` allowlists rubik (default), nunito, poppins, montserrat,
work-sans, karla, jost, figtree, raleway — each vetted for a true
500/700/700-italic set (Lexend/Manrope/Sora were excluded: no italics).
Files are self-hosted woff2 in `apps/web/public/fonts/` (mirroring the Rubik
setup; Google Fonts CDN would leak learner IPs — an ADR-0019 compliance
no-go). Only the org's chosen face gets `@font-face` + preload on learner
pages; `/admin/branding` loads all nine for picker specimens. Rubik stays in
every fallback stack.

### D5 — Logos: raster-only, org-prefixed R2 keys, white plate in chrome

`branding/{org_id}/logo.{png|jpg|webp}` via `brandingLogoKey` +
`assertBrandingLogoKey` (the logo twin of the recordings guard). **SVG is
refused at three layers** (key shape, magic-byte sniff, MIME map) because SVG
can embed script. Uploads run server-side in the action — ≤1 MB, bytes
sniffed (`sniffImageType`) so the browser's MIME claim is irrelevant — no
client presigned PUT. Serving is `GET /api/branding/logo`: org from session
ctx only, 302 to a 15-minute signed URL, `private, max-age=600` so a cached
redirect can't outlive its signature. In chrome the logo always renders on a
white plate (`OrgLogo`) — the only treatment that guarantees visibility for
arbitrary uploads on the dark header, per the BRAND.md busy-background rule.

### D6 — Access: OrgAdmin self-serve on every plan; SuperAdmin reset under SYSTEM_ORG_ID

`/admin/branding` is plain `requireRole("OrgAdmin")` — no plan gating (the
RBAC note: there is still no central `can()` helper; CLAUDE.md's reference to
`auth/can.ts` is drift, flagged separately). ActivityLog: `branding.updated`
/ `branding.reset` / `branding.logo_updated` / `branding.logo_removed` under
the org; the SuperAdmin reset on `/orgs/[id]` logs `super.branding.reset`
under `SYSTEM_ORG_ID` with `target_org_id` metadata.

### D7 — Clerk touchpoints: branded after first sign-in only (v1)

Clerk invitation **emails** are templated per Clerk instance, not per org —
they keep platform branding. Pre-auth `/sign-up` branding was considered and
deferred: the `__clerk_ticket` is opaque client-side and Clerk offers no
clean server lookup by ticket, so any pre-auth org lookup would need a
client-supplied org hint — a tenancy smell. Learners see org branding from
their first authenticated page (`/post-signin` → `/home`). Revisit if Clerk
exposes ticket introspection, or when invites move to Resend.

### D8 — R2 deletes are best-effort

Replaced/reset logos are deleted from R2 after the DB write; a failed delete
orphans one ≤1 MB object (cost nuisance) rather than failing the user action
or leaving the DB pointing at a deleted object. Same-format re-uploads
overwrite in place (stable basename `logo.{ext}`), so orphans only occur on
format changes.

## Consequences

- **Good:** zero per-component changes — every `bg-brand-red` etc. retones
  via the token indirection; unbranded orgs are pixel-identical to before;
  unreadable themes are unrepresentable in the DB; tenant isolation is
  fuzzer-enforced (`OrgBranding` is drift-guarded into the tenancy set).
- **Bad / accepted:** `--brand-black` override retones body text too (an org
  picking navy gets navy text — cohesive, but a surprise to document);
  Stripe Checkout/Portal and Clerk emails stay platform-branded; the
  `/admin/branding` axe gate exposed that small `#EE2346` text on light
  surfaces fails AA (4.23:1) — this page uses `brand-red-dark` for 14px red
  text, and the brand skill checklist needs the same correction app-wide.
- **Follow-ups:** apply the small-red-text AA fix to other admin surfaces;
  consider plan-gating branding as a paid feature when pricing tiers firm
  up; per-org invite emails via Resend (unlocks D7).

## Verification

`packages/db/src/branding.test.ts` + `org-branding.test.ts` (44 tests:
contrast gates, derivation, isolation, clamping, SYSTEM_ORG_ID logging);
`packages/storage` key/sniff tests (42); `apps/web/tests/e2e/branding.spec.ts`
(invalid palette blocked; save → own learner themed, other org byte-clean;
axe AA on the editor); live R2 smoke test (upload → signed serve → header
render → remove).
