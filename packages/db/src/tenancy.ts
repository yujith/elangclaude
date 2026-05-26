import { Prisma, type Role } from "@prisma/client";
import { prisma } from "./client";

// ─── Public types ─────────────────────────────────────────────────────────

export type OrgContext = {
  org_id: string;
  user_id: string;
  role: Role;
};

export class RoleRequiredError extends Error {
  constructor(
    public readonly required: Role,
    public readonly actual: Role,
  ) {
    super(`Role ${required} required, got ${actual}.`);
    this.name = "RoleRequiredError";
  }
}

// ─── Source-of-truth list of tenant-scoped models ─────────────────────────
//
// Every model that carries `org_id` must appear here. The fuzzer in
// `tenancy.test.ts` cross-references this set against the actual schema and
// fails CI if they drift, so adding a new tenant model and forgetting this set
// is caught automatically.

export const TENANT_SCOPED_MODELS: ReadonlySet<Prisma.ModelName> = new Set([
  "User",
  "Attempt",
  "Answer",
  "Grade",
  "Recording",
  "QuotaUsage",
  "ActivityLog",
  "MockSession",
  "AiCallLog",
  "StripeEventLog",
]);

// ─── Internals ────────────────────────────────────────────────────────────

const READ_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "aggregate",
  "count",
  "groupBy",
]);

const WRITE_WHERE_OPS = new Set([
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
]);

type AnyArgs = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
  create?: Record<string, unknown>;
  update?: Record<string, unknown>;
};

function injectWhere(args: AnyArgs, org_id: string): AnyArgs {
  args.where = { ...(args.where ?? {}), org_id };
  return args;
}

function injectOrgId(
  data: Record<string, unknown> | Record<string, unknown>[] | undefined,
  org_id: string,
): Record<string, unknown> | Record<string, unknown>[] | undefined {
  if (data === undefined) return data;
  if (Array.isArray(data)) {
    return data.map((row) => ({ ...row, org_id }));
  }
  return { ...data, org_id };
}

// ─── withOrg(ctx) ─────────────────────────────────────────────────────────
//
// Wraps the singleton PrismaClient in a Prisma extension that:
//
//   1. Injects `org_id = ctx.org_id` into the `where` clause of every read,
//      update, delete, and upsert call against a tenant-scoped model. Prisma
//      4.5+ accepts non-unique filters on `findUnique`, so `findUnique(
//      { where: { id } })` becomes `findUnique({ where: { id, org_id } })`
//      — no `findFirst` rewrite needed.
//
//   2. Overrides `org_id` in the `data` payload of every create / createMany
//      / upsert.create / update / upsert.update. Even if the caller tries to
//      smuggle `data: { org_id: otherOrg }`, the proxy clamps it to ctx.org_id.
//
//   3. Leaves global models (`Organization`, `Test`, `Question`) untouched.
//      Listing them here would break legitimate cross-org queries against the
//      shared content pool.
//
// Caveat: relation `include`/`select` blocks do not re-enter the proxy. In
// the current schema, every reachable relation is parented by an org-scoped
// row so isolation is implicit. If a future model breaks that assumption, add
// an explicit relation filter at the call site and document the case.

export function withOrg(ctx: OrgContext) {
  return prisma.$extends({
    name: "withOrg",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_SCOPED_MODELS.has(model as Prisma.ModelName)) {
            return query(args);
          }

          const next = { ...(args as AnyArgs) } as AnyArgs;

          if (READ_OPS.has(operation) || WRITE_WHERE_OPS.has(operation)) {
            injectWhere(next, ctx.org_id);
          }

          if (operation === "create" || operation === "createMany") {
            next.data = injectOrgId(next.data, ctx.org_id) as AnyArgs["data"];
          }

          if (operation === "upsert") {
            if (next.create !== undefined) {
              next.create = injectOrgId(
                next.create,
                ctx.org_id,
              ) as Record<string, unknown>;
            }
            if (next.update !== undefined) {
              next.update = injectOrgId(
                next.update,
                ctx.org_id,
              ) as Record<string, unknown>;
            }
          }

          if (operation === "update" || operation === "updateMany") {
            if (next.data !== undefined) {
              next.data = injectOrgId(next.data, ctx.org_id) as AnyArgs["data"];
            }
          }

          return query(next as typeof args);
        },
      },
    },
  });
}

// ─── withSuperAdminContext(ctx) ───────────────────────────────────────────
//
// Returns the unextended PrismaClient — global queries are intentional. Use
// only from SuperAdmin surfaces (`apps/web/app/(super)/...`). Throws
// `RoleRequiredError` if the caller's role is anything else.
//
// `withOrg()` and `withSuperAdminContext()` must NEVER be used in the same
// function. If a feature seems to need both, it is two features.

export function withSuperAdminContext(ctx: OrgContext) {
  if (ctx.role !== "SuperAdmin") {
    throw new RoleRequiredError("SuperAdmin", ctx.role);
  }
  return prisma;
}
