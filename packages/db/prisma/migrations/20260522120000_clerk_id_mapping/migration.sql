-- Add Clerk identity mapping columns. Both are nullable so existing seeded
-- rows (and the singleton "system" org) keep working without a Clerk
-- counterpart. The Clerk webhook populates them on org/user create and
-- updates them on rename/delete. requireOrgContext lazy-links by email on
-- first sign-in for seeded users that pre-date their Clerk account.

ALTER TABLE "Organization" ADD COLUMN "clerk_org_id" TEXT;
CREATE UNIQUE INDEX "Organization_clerk_org_id_key" ON "Organization"("clerk_org_id");

ALTER TABLE "User" ADD COLUMN "clerk_user_id" TEXT;
CREATE UNIQUE INDEX "User_clerk_user_id_key" ON "User"("clerk_user_id");
