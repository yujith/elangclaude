# ADR 0013 — Org Admin dashboard: thin slice without email

- Date: 2026-05-20
- Status: Accepted

## Context

The MVP scope in `CLAUDE.md` includes "org admin bulk invite + seat usage
+ activity log", but the production auth provider (Clerk) is not yet
wired in — auth still rides on a dev-only signed cookie (see
`apps/web/lib/auth/dev-session.ts`), and `Resend` for transactional email
is in the locked-in stack (`.claude/rules/architecture.md`) but not yet
configured. We wanted to unblock a sales-demoable Org Admin surface
without taking on Clerk + Resend at the same time.

The risk: an "invite" flow that doesn't actually send an invite email
isn't really an invite, and a thrown-together "claim this account"
landing page would have to be rebuilt the moment Clerk lands. We also
needed to make the surface defensibly multi-tenant from line one — an
admin who can list / invite learners is exactly the role most likely to
trip a tenancy bug.

## Decision

Ship the Org Admin dashboard as a thin slice that is honest about what
it is: a **roster import** today, a real invite flow once Clerk lands.

### D1 — No email in this slice. Email is the join key.

`inviteLearner` creates a dormant `User` row scoped to the OrgAdmin's
org, keyed by `email`. No email is sent; the admin tells the learner
out-of-band. When Clerk lands, the learner's first sign-in matches by
`email` and they're already in the right org. The flow doesn't change
shape — only the "click to claim" step gets a real backing system.

Trade-off accepted: a school admin still has to share a link with the
learner, but the data side is ready and consistent with the eventual
Clerk + Resend flow. We didn't want to build a throwaway claim page
that points at `/dev/login`.

### D2 — Cross-org email collisions return a generic refusal

`inviteLearnerForOrg` does one intentional cross-org check:

```ts
const existing = await prisma.user.findUnique({ where: { email }, ... });
if (existing && existing.org_id !== ctx.org_id) {
  return { ok: false, reason: "cannot_invite" };
}
```

The lookup must be cross-org — that's the *point* of the check — but the
foreign `org_id` never flows back to the caller. Any cross-org hit
collapses to the same `"cannot_invite"` reason as a generic failure, so
an OrgAdmin cannot enumerate which emails exist on the platform.

This is the only raw `prisma.*` call (not `withOrg(ctx)`) in the slice;
the comment in `packages/db/src/admin-invite.ts` flags it explicitly so
future code review notices the unusual pattern.

### D3 — Seat-limit + create in a single transaction

The seat-limit check (`count(User where role=Learner) < seat_limit`) and
the `user.create` run inside one `prisma.$transaction` to avoid a small
overshoot window when two CSV uploads race. We accepted that the
transaction client (`tx`) is *not* the `withOrg`-extended one, so the
`org_id` is injected by hand into the count's `where` and the create's
`data`. Behavior is covered by 6 vitest cases (seat-limit, idempotency,
cross-org refusal, invalid email, CSV splits, CSV idempotency).

Future hardening (P2, not in this slice): a `withOrgTx(ctx, async (db)
=> …)` helper that extends the transaction client. Not pursued now
because the failure mode is "future edits add a query inside this
transaction and forget the org filter" — a code-review concern, not a
current bug.

### D4 — SuperAdmin moderation activity is filtered out at the read site

SuperAdmin actions (`content.reading.approved`, etc.) currently write
`ActivityLog` rows under the SuperAdmin's home org for cost attribution
(ADR 0004 D4). That means an OrgAdmin's recent-activity feed leaks
moderation events from across the platform whenever the SuperAdmin's
home org happens to be theirs.

The proper fix is a dedicated SuperAdmin system org (already flagged in
the comment at `apps/web/lib/reading/moderation-actions.ts:9-12`). That
migration is out of scope here. In the meantime, both `/admin` and
`/admin/activity` filter at the read site:

```ts
where: { NOT: { action: { startsWith: "content." } } }
```

When the system-org migration lands, this filter can be removed — it
becomes a no-op.

### D5 — CSV is admin-pasted, minimal-parser, 500-row cap

The CSV format is `email[,name]`, one record per line, no quoting. A
leading row whose first cell is `"email"` is treated as a header and
skipped. Hard cap at 500 rows; beyond that we report a `truncatedAt`
marker so the UI can warn. Names with commas lose the suffix —
acceptable because this CSV is pasted by an admin, not user-uploaded
arbitrary data.

### D6 — Defaults: `ielts_track = Academic`, page size 50

Invited learners default to Academic track; they can switch in their
own settings later. Roster and activity pages paginate at 50 rows.
Activity uses cursor-based pagination (`?cursor=<timestamp ISO>`); the
cursor is user-controlled but only narrows `timestamp` *within* the
caller's `withOrg`-scoped query, so it can at worst show older rows
from the same org.

### D7 — Header chrome follows SuperAdmin

The OrgAdmin layout uses the same clean header rhythm as SuperAdmin:
logo + `Org admin` role cue on the left, then a single right-aligned
menu group (`Overview`, `Learners`, `Activity`, `Profile`, `Sign out`).
We intentionally do not show the admin's name or org metadata in the
header; that information belongs in the page body and profile surface.
Keeping the role headers visually aligned prevents each dashboard from
developing its own chrome.

## Consequences

### Good

- OrgAdmin surface is sales-demoable today without blocking on Clerk +
  Resend.
- Data model and invite flow shape are stable; the Clerk + Resend
  follow-up only adds the "claim" step.
- Cross-org email enumeration leak is closed.
- Tenancy fuzzer (`packages/db/src/tenancy.test.ts`) and 11 new invite
  cases pin the contract.

### Bad

- A learner who is "invited" today receives nothing from the platform —
  the admin must share the sign-in path themselves. This is honest, not
  graceful.
- The `prisma.$transaction` in `inviteLearnerForOrg` is correct but
  bypasses `withOrg`; a careless future edit could regress isolation.
  Mitigated by vitest, not by the type system.
- The SuperAdmin-activity filter is a workaround that will turn into
  dead code once the system-org migration lands. Acceptable cost.

## Follow-ups

- Wire Clerk; replace `requireOrgContext` cookie path with Clerk session.
  Add a "claim invite" landing that matches by email.
- Wire Resend; send the invite email from `inviteLearner`.
- Migrate the seeded SuperAdmin to a dedicated system org; delete the
  `content.*` read-site filter from `(admin)/admin/page.tsx` and
  `(admin)/admin/activity/page.tsx`.
- Consider a `withOrgTx` helper if any other server action needs a
  transaction that crosses tenant-scoped models.
