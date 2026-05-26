# ADR 0018 — Multi-org user membership

- Date: 2026-05-26
- Status: Proposed (Phase 0 not yet started)

## Context

ADR-0014 D7 captured the rule "Learners get NO Clerk org membership;
OrgAdmin + SuperAdmin home-org memberships use `org:admin`." That rule
is paired with two `@unique` constraints in `packages/db/prisma/
schema.prisma` that together encode "one email, one user, one org":

- `User.email @unique`
- `User.clerk_user_id @unique`

ADR-0017 introduces a public self-serve signup flow at `/signup-org`.
That flow needs to handle the case where an existing platform user
(already a Learner in Org A, or already a SuperAdmin) signs up to
create a brand-new Org B for themselves. The user picked "Allow — same
Clerk user, second Org membership" when this was raised during planning.

The current schema cannot represent that case. This ADR records the
schema reversal and the partial supersession of ADR-0014 D7.

The implementation plan is `docs/plans/stripe-self-serve-onboarding.md`
Phase 0. Phase 0 ships behind `MULTI_ORG_ENABLED=1` so it can roll back
without a schema revert.

## Decision

### D1 — Drop global uniqueness, scope to `(org_id, *)`

The Prisma migration replaces the two top-level uniques with composite
ones:

```prisma
model User {
  // ...
  // (removed) email         @unique
  // (removed) clerk_user_id @unique

  @@unique([org_id, email])
  @@unique([org_id, clerk_user_id])
}
```

The same Clerk user can now hold a User row in N Orgs. Each Org sees
exactly one User row for that Clerk identity, scoped to itself.

The existing per-Org indexes (`@@index([org_id])`, etc.) stay. The
composite uniques add their own indexes for fast lookup on
`(org_id, email)` and `(org_id, clerk_user_id)`.

### D2 — Active Clerk Org drives DB-User selection

`apps/web/lib/auth/context.ts → requireOrgContext` resolves to a DB
User row by reading the **active Clerk Org** from session:

1. Read `clerkUserId` + `activeClerkOrgId` from Clerk session.
2. Find DB User by `(clerk_user_id, org_id)` where
   `org_id` matches the Org row carrying `clerk_org_id = activeClerkOrgId`.
3. If no DB row matches but `(email, org_id)` does, lazy-link and stamp
   `clerk_user_id` (preserves the seeded-user path).
4. If the Clerk session has multiple memberships but no active Org
   (rare race after sign-in), redirect to a new `/select-org` page that
   renders Clerk's `<OrganizationList />`.
5. SuperAdmin's cross-org powers still come from the DB `role` column,
   independent of how many Clerk Orgs they belong to. The active Clerk
   Org just picks **which** DB User row of theirs is loaded as the
   default `OrgContext`.

Rejected alternative: an `active_org_id` cookie set by an in-app org
switcher. Adds duplicate state alongside Clerk's own active-org tracking
and risks drift. Clerk's session claim is authoritative.

### D3 — Webhook updates fan out across all DB rows for a Clerk user

`packages/db/src/clerk-sync.ts`:

- `applyClerkUserUpsert(data)`: iterates **all** DB User rows with
  `clerk_user_id = data.id` (not just one) and updates each. `email`
  and `name` propagate; per-Org fields (e.g. `role`, `ielts_track`,
  `deleted_at`) are untouched here — they belong to membership events.
- `applyClerkUserDeleted(clerkUserId)`: soft-deletes **all** rows for
  this Clerk user. A Clerk account deletion is a "this person is gone
  from the platform" event.
- `applyClerkMembershipUpsert(data)` and
  `applyClerkMembershipDeleted(data)`: already org-scoped; minor tweak
  to look up by `(clerk_user_id, org_id)` instead of by
  `clerk_user_id` alone.

The webhook handler in `apps/web/app/api/clerk/webhook/route.ts` is
unchanged in shape — only the helper functions change.

### D4 — ADR-0014 D7 partially superseded

D7 of ADR-0014 stated:

> Learners get NO Clerk org membership (decision in ADR-0014 D7).
> OrgAdmin + SuperAdmin home-org memberships use the prefixed role
> key `"org:admin"`.

That rule stands for **Learners** — they remain single-org by
convention. The learner-invite path
(`packages/db/src/admin-invite.ts`) continues to refuse cross-org
invites of the same email at the application layer, even though the
schema now technically supports it. The cross-org email block becomes
**Org-scoped**: same `(email, org_id)` → refuse;
same email in another org → allow (for OrgAdmin self-serve), refuse
for Learner invites (unchanged Learner UX).

For **OrgAdmin** and **SuperAdmin**, multi-org membership is now
supported. An OrgAdmin can be billing-owner of Org A and also a
member of Org B (e.g. they self-served a new Org while still admin of
their old one). The `(admin)/layout.tsx` header gets Clerk's
`<OrganizationSwitcher>` so they can flip between Orgs in the UI.

### D5 — Single Prisma migration, feature-flagged code path

The schema migration drops the global uniques and adds the composite
ones in a single migration step. This is safe because no existing data
violates the new constraints (today every email/clerk_user_id is unique
globally, which is a strict subset of "unique per Org").

The application code path that creates a *second* User row for the
same Clerk user (the self-serve provisioning action) is feature-
flagged with `MULTI_ORG_ENABLED=1`. Phases 1–5 of the implementation
plan can ship before the flag is flipped on; only Phase 6 (self-
serve) requires the flag to be live.

Rollback: re-add the `@unique` constraints. As long as the flag has
not been flipped on in production, no data collisions exist and the
revert is clean.

### D6 — `billing_owner_user_id` lives on Organization, not on User

ADR-0017 D9 introduces `Organization.billing_owner_user_id`. With
multi-org, a single Clerk user could be billing-owner of multiple
Orgs. Storing the pointer on Organization (rather than a flag on
User) makes the "who pays for this Org?" question Org-local and
unambiguous, and it survives the billing owner being removed from the
Org (we either reassign or null it out, both single-row writes).

## Consequences

### Good

- Self-serve signup can handle existing users without rejecting them.
- Schema is more honest: org membership is a many-to-many concept and
  the data model now reflects that.
- ADR-0014 D7's Learner-single-org rule survives intact — only the
  schema gets more permissive, the Learner UX is unchanged.
- Clerk's `<OrganizationSwitcher>` is a free UI primitive that we get
  to plug in without writing our own.

### Bad

- Phase 0 is invasive: `clerk-sync.ts`, `requireOrgContext`,
  `admin-invite.ts`, and `profile.ts` all need updates. Bug surface is
  larger than any single past auth ADR.
- The "who am I right now?" question becomes context-dependent (which
  Clerk Org is active). A user with N memberships could be confused
  about which Org they're acting in — the `<OrganizationSwitcher>`
  must be prominent and the role header must show the current Org
  name.
- Lazy-link by email is now Org-scoped. A seeded user who exists in
  Org A and signs in via Clerk while their active Clerk Org is Org B
  would currently fail to link. Resolution: the lazy-link logic falls
  back to "any DB row for this email" when no exact `(email, org_id)`
  match exists, and only stamps `clerk_user_id` for the matched row.
  This preserves the seeded-user-onboarding path.
- SuperAdmin's "home org" concept is fuzzier. A SuperAdmin DB row
  lives in one Org (Org A in seed); their cross-org powers come from
  `role`, not from membership. Multi-org doesn't change that, but it
  does mean a SuperAdmin who self-serves their own Org B now has two
  DB User rows. Either row's `OrgContext` works for SuperAdmin
  surfaces. Surprising but harmless — flagged for future polish.

## Follow-ups

- Add SuperAdmin UI to view a Clerk user's Org memberships (currently
  there's no surface that lists "all orgs this email touches").
- Consider an in-app way to leave an Org (today: SuperAdmin removes
  the User; OrgAdmin removes Learners; no self-leave for OrgAdmins).
- Audit `packages/db/src/clerk-sync.ts` for any remaining single-row
  assumptions once Phase 0 lands.
- Tenancy fuzzer extension: two Orgs sharing an email, sign in as one,
  assert zero leakage. Add this to `packages/db/src/tenancy.test.ts`
  in Phase 0.
- Revisit ADR-0014 D7 wording in CLAUDE.md to clarify the OrgAdmin /
  Learner asymmetry.
