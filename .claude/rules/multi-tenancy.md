# Multi-Tenancy Rules

> Auto-loaded with every Claude Code session. These rules are non-negotiable.

## The one rule

**Every database query, every storage path, every cache key, every log line must be scoped by `org_id`.** A learner from Org A must never, under any circumstance, be able to read, list, or even know about data from Org B. This is how we lose enterprise customers permanently.

## How to enforce it

### Database (Prisma)

Never write a raw `prisma.user.findMany()` in application code. Use the tenancy helper:

```ts
// packages/db/src/tenancy.ts exports:
import { withOrg } from "@/db/tenancy";

// In an API route or server action:
const users = await withOrg(ctx).user.findMany({ where: { role: "Learner" } });
//             ^^^^^^^^^^^^^ — automatically injects { org_id: ctx.org_id }
```

The `withOrg(ctx)` proxy wraps the Prisma client and injects `org_id` into every `where` clause for tables that have an `org_id` column. If you find yourself bypassing it, **stop and ask why** — the answer is almost always "I shouldn't be."

### Routes & Server Actions

Every route handler starts with:

```ts
const ctx = await requireOrgContext(request);
//          ^^^^^^^^^^^^^^^^^^^^^^^ — pulls org from session, 401s if missing,
//                                    403s if user role insufficient.
```

Never read `org_id` from the request body or query string. Only from the authenticated session.

### Object Storage (R2)

Every key prefixed with org: `recordings/{org_id}/{user_id}/{attempt_id}.webm`. Signed URLs only — never expose raw bucket paths. Default expiry: 15 minutes.

### SuperAdmin is the only exception

`SuperAdmin` may query across orgs. This is enforced by `withSuperAdminContext()` which is a separate helper. **`withOrg()` and `withSuperAdminContext()` must never be used in the same function.** Pick one, stick with it.

## What "audit a query" looks like

When reviewing or writing any DB code, ask:
1. Does this query touch a table that has `org_id`?
2. If yes, is `org_id` in the `where` clause?
3. Is `org_id` coming from the authenticated session, not user input?
4. If a join hits another org-scoped table, is that table also scoped?

If any answer is "no" or "unsure" — the query does not ship.

## Test it

`packages/db/src/tenancy.test.ts` contains a fuzzer that creates two orgs, populates both, and asserts that org A's user cannot see org B's anything. Every PR that touches tenancy must pass this fuzzer. CI fails the build if it doesn't.

## Anti-patterns — never do these

- ❌ `prisma.user.findUnique({ where: { id } })` — `id` from user input, no org filter.
- ❌ Reading `org_id` from a cookie/header that the client controls.
- ❌ A "global cache" keyed only by `user_id` (collisions across orgs are possible if IDs aren't UUIDs, and even then it's a code smell).
- ❌ Hardcoding `org_id = "demo"` in a test that runs against the real client. Use `withOrg(testCtx)` in tests too.
- ❌ Using `SuperAdmin` privileges to "make a feature work" for an org admin. If an org admin can't do it through `withOrg`, they shouldn't be doing it.
