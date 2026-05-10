---
name: multi-tenant-prisma
description: Use this skill when writing or reviewing any Prisma query, schema change, migration, or API route that touches the database. Provides the canonical patterns for org_id scoping via the withOrg() helper, the SuperAdmin escape hatch, schema conventions for tenant isolation, the tenancy fuzzer test pattern, and common mistakes that have leaked tenant data in past sprints. Trigger on any edits in `packages/db/`, `apps/web/app/api/`, server actions, or Prisma schema/migration files.
---

# Multi-Tenant Prisma Skill

## Why this skill exists

Multi-tenant data leaks are existential for a B2B SaaS. The `withOrg()` proxy is our defense — but only if every developer (and Claude) actually uses it. This skill is the muscle memory.

## The schema convention

Every tenant-scoped table includes:

```prisma
model SomeThing {
  id        String       @id @default(cuid())
  org_id    String
  org       Organization @relation(fields: [org_id], references: [id], onDelete: Cascade)
  // ... other fields
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  @@index([org_id])
  @@index([org_id, createdAt])  // common access pattern
}
```

Tables that are **NOT** tenant-scoped: `Organization`, `Test` (global content pool), `Question` (belongs to Test). Everything user-related, attempt-related, recording-related, log-related is tenant-scoped.

## The `withOrg()` pattern

```ts
// packages/db/src/tenancy.ts
import { PrismaClient } from "@prisma/client";

type OrgContext = { org_id: string; user_id: string; role: Role };

export function withOrg(ctx: OrgContext) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (TENANT_SCOPED_MODELS.has(model) && isReadOrWrite(operation)) {
            args.where = { ...args.where, org_id: ctx.org_id };
            // For creates, also inject org_id into data:
            if (operation === "create" || operation === "createMany") {
              args.data = injectOrgId(args.data, ctx.org_id);
            }
          }
          return query(args);
        },
      },
    },
  });
}
```

Usage in a route:

```ts
import { requireOrgContext } from "@/auth/context";
import { withOrg } from "@/db/tenancy";

export async function GET(req: Request) {
  const ctx = await requireOrgContext(req);
  const db = withOrg(ctx);

  const attempts = await db.attempt.findMany({
    where: { user_id: ctx.user_id },   // org_id auto-injected
    include: { grade: true },
    orderBy: { submitted_at: "desc" },
  });

  return Response.json(attempts);
}
```

## SuperAdmin escape hatch

```ts
import { withSuperAdminContext } from "@/db/tenancy";

const db = withSuperAdminContext(ctx);  // requires role === "SuperAdmin"
//          ^^^^^^^^^^^^^^^^^^^^^^^^^ throws if role insufficient
```

`withOrg()` and `withSuperAdminContext()` must **never** appear in the same function. If a feature seems to need both, it's two features.

## Migration hygiene

- New tenant-scoped tables: include `org_id` from migration #1, never bolt it on later.
- Adding `org_id` to an existing table: backfill in a separate migration *before* enforcing NOT NULL.
- Deleting an org: `onDelete: Cascade` from `Organization` to all its tables. Plus a hard delete of recording objects from R2 (see `packages/ai/src/storage/cleanup.ts`).

## The fuzzer

`packages/db/src/tenancy.test.ts`:

```ts
test("org isolation fuzzer", async () => {
  const orgA = await createTestOrg();
  const orgB = await createTestOrg();
  await seedActivity(orgA, 50);
  await seedActivity(orgB, 50);

  const dbA = withOrg({ org_id: orgA.id, user_id: orgA.adminId, role: "OrgAdmin" });

  // 1. orgA can't list orgB users
  const users = await dbA.user.findMany();
  expect(users.every(u => u.org_id === orgA.id)).toBe(true);

  // 2. orgA can't fetch a known orgB record by ID
  const orgBAttempt = await prisma.attempt.findFirst({ where: { org_id: orgB.id } });
  const leak = await dbA.attempt.findUnique({ where: { id: orgBAttempt!.id } });
  expect(leak).toBeNull();

  // 3. orgA can't update an orgB record
  const updated = await dbA.attempt.updateMany({
    where: { id: orgBAttempt!.id },
    data: { status: "hijacked" },
  });
  expect(updated.count).toBe(0);
});
```

This test is **mandatory in CI**. If you change tenancy logic, run this against `--repeat-each=100` locally first.

## Common mistakes Claude has made before

- Using `prisma.x.findMany()` directly inside a server action because "the helper felt like overkill". It is never overkill. Always go through `withOrg()`.
- Adding a new tenant-scoped model and forgetting to add it to `TENANT_SCOPED_MODELS`. Fix: every new model gets a checklist comment in its migration PR.
- Filtering by `user_id` only, on the assumption that `user_id` is unique. It is unique — but the query plan won't use the `(org_id, ...)` index, hurting perf at scale.
- Using `prisma.$queryRaw` for "complex" reports without manually adding `WHERE org_id = ${ctx.org_id}`. Raw SQL bypasses the proxy entirely. If you must use raw, **wrap it** in a function that accepts `OrgContext` and concatenates the filter.

## Gotchas (highest-signal section — add to over time)

- **2026-01-15**: A learner's `ActivityLog` query forgot `org_id` because the route trusted `userId` from the query string. Caught in code review. Lesson: never read `org_id` or any tenant identifier from request input.
- **2026-02-02**: A migration to add a new index forgot to include `org_id` as the leading column, so query planner did full scans on `(submitted_at)`. Slow but not insecure. Lesson: indexes on tenant tables lead with `org_id`.
- **2026-05-09**: While building `packages/db` we considered rewriting `findUnique` to `findFirst` inside the proxy because `findUnique`'s typed `where` is the unique-shape only. Turned out unnecessary — Prisma 4.5+ supports **extended `where` unique conditions**, so injecting `org_id` into a `findUnique({ where: { id } })` produces `findUnique({ where: { id, org_id } })` and Prisma accepts it. We did **not** add a `@@unique([id, org_id])` compound. If we ever drop below Prisma 4.5 we'll need to revisit. The fuzzer in `packages/db/src/tenancy.test.ts` covers the assertion explicitly.
- **2026-05-09**: `prisma.$extends({ query: { $allModels: { $allOperations } } })` does **not** re-enter for relations loaded via `include`/`select`. In the current schema every reachable child relation is parented by an org-scoped row, so isolation holds implicitly through the FK graph. If we ever add a model where a relation can short-circuit that (e.g. a global table that links back into a tenant table without a parent scope), add an explicit relation filter at the call site and document the case. The `relation includes inherit isolation` test in the fuzzer pins this assumption.
- **2026-05-09**: The proxy also strips/clamps `org_id` from `data` on `create`, `createMany`, `upsert.create`, `upsert.update`, `update`, and `updateMany`. A caller cannot move a row across orgs by smuggling `data: { org_id: otherOrg }` — the proxy overrides it with `ctx.org_id` before Prisma sees the payload. The fuzzer's `create/upsert clamping` tests cover this; deleting any of those overrides is a P0 regression.
