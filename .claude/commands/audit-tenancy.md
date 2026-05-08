---
description: Audit the working tree for multi-tenancy violations. Run before merging anything that touches the database, API routes, or storage.
---

# /audit-tenancy

Find every place in the diff (or working tree) that could leak tenant data. Output a report.

## Step 1 — Scope the audit

- If there's an unstaged/staged diff: audit only that diff plus its callers.
- If invoked with no diff: audit the entire `apps/web/app/api/`, all Server Actions, and `packages/db/`.

Use ripgrep to find candidates. Don't rely on memory.

## Step 2 — For every Prisma call found

Verify:
1. Is the call going through `withOrg(ctx)` or `withSuperAdminContext(ctx)`?
2. If raw SQL (`$queryRaw`/`$executeRaw`), does it explicitly include `WHERE org_id = ${ctx.org_id}`?
3. Where does `ctx.org_id` come from? **Must be from the authenticated session, never from request body/query/headers.**
4. Are joined/included tables also tenant-scoped, and is each properly filtered?

Flag every call that fails any check as a **P0 finding**.

## Step 3 — For every storage operation found

Verify R2 keys are prefixed with `org_id`, and that signed URL generation enforces the same prefix.

## Step 4 — For every cache key

Verify `org_id` is part of the key. A key like `user:${user_id}:profile` is fine *only* if `user_id` is globally unique (we use cuid, so yes) — but the convention is still to lead with `org:${org_id}:user:${user_id}:...` for grep-ability.

## Step 5 — For every log line

Confirm tenant-sensitive fields aren't logged in plain text without `org_id` context. Logs without `org_id` are useless for debugging anyway.

## Step 6 — Report

```md
# Tenancy Audit Report

## Files reviewed
- ...

## P0 findings (block merge)
- `apps/web/app/api/x/route.ts:42` — `prisma.attempt.findMany()` with no `withOrg` wrapper. Suggested fix: ...

## P1 findings (must fix this sprint)
- ...

## P2 findings (cleanup, non-blocking)
- ...

## Clean
- N files reviewed, M Prisma calls verified.
```

If any P0 findings exist, the recommendation is **do not merge**.
