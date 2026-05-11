// Public surface for `@elc/db`. Keep this file thin.
//
// `.claude/rules/architecture.md` says no barrel files in performance-sensitive
// packages. This file is the deliberate exception: it re-exports only the two
// helpers and a handful of types — no `export * from "./client"` glob — so the
// rule's intent (avoid pulling in the world to read one symbol) holds.

export { withOrg, withSuperAdminContext, RoleRequiredError, TENANT_SCOPED_MODELS } from "./tenancy";
export type { OrgContext } from "./tenancy";

export {
  Prisma,
  type Role,
  type Track,
  type Section,
  type AttemptStatus,
  type TestStatus,
  type GraderKind,
  type OrgStatus,
  type Organization,
  type User,
  type Test,
  type Question,
  type Attempt,
  type Answer,
  type Grade,
  type Recording,
  type QuotaUsage,
  type ActivityLog,
} from "@prisma/client";
