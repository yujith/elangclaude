# Compliance records

Operational compliance documentation for eLanguage Center. These are the
internal records that back the public policies in `apps/web/app/{privacy,terms,
cookies,dpa,sub-processors}`. See `docs/adr/0019-compliance-and-data-rights.md`
for the architecture and decisions.

> **Counsel review pending.** The public policy copy and these records are
> good-faith, jurisdiction-aware drafts. Have qualified counsel review them per
> jurisdiction (GDPR/UK, Australia, India DPDP, Sri Lanka PDPA, and the SEA
> PDPAs) before relying on them as final.

## Contents

- [`sub-processors.md`](./sub-processors.md) — canonical sub-processor register.
- [`ropa.md`](./ropa.md) — Records of Processing Activities (GDPR Art 30).
- [`breach-runbook.md`](./breach-runbook.md) — personal-data-breach response.

## Where the machinery lives

| Concern | Code |
|---|---|
| Policy versions / consent binding | `apps/web/lib/legal/policies.ts` |
| Consent ledger | `packages/db/src/consent.ts`, `ConsentRecord` |
| Cookie consent banner | `apps/web/components/consent/*`, `/api/consent` |
| Data-subject rights | `packages/db/src/data-rights.ts`, `/profile`, `/api/me/export` |
| Retention + erasure execution | `packages/db/src/retention.ts`, `/api/cron/retention` |
| Controller/processor + region + minors | `Organization.controller_model` / `data_region`, `User.age_assurance` |

## Routine maintenance

- **Add/remove a vendor:** update `sub-processors.md` AND the
  `/sub-processors` page list, bump the version in `lib/legal/policies.ts`, and
  give org customers notice per the DPA.
- **Material policy change:** edit the copy, bump the version + effective date
  in `lib/legal/policies.ts`. Authenticated users will be re-prompted where the
  stored consent version is older.
- **Retention change:** `DEFAULT_RECORDING_RETENTION_DAYS` in
  `packages/db/src/retention.ts` must match what the Privacy Policy discloses.
