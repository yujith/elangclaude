// Singleton "system" Organization used as the parent for SuperAdmin-level
// ActivityLog rows (content moderation, org CRUD, future super.* actions).
//
// Why a singleton org instead of a nullable ActivityLog.org_id:
//   - ActivityLog.org_id is non-null in the schema. Making it nullable
//     would require every existing query to handle the null case.
//   - With a fixed id we get a single "WHERE org_id = 'system'" predicate
//     for any future audit page.
//   - The /orgs SuperAdmin list filters this id out so customers never see
//     a row labelled "system".
//
// Seeded in packages/db/prisma/seed.ts. The row is created with
// status = Archived so it cannot accidentally hold real users.

export const SYSTEM_ORG_ID = "system";
export const SYSTEM_ORG_NAME = "eLanguage Center (system)";
