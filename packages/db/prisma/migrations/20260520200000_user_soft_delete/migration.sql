-- Phase 2 of the SuperAdmin feature: soft-delete column on User.
-- SuperAdmins can remove a user without dropping Attempts/Grades/Recordings.
-- A non-null deleted_at blocks sign-in (loadOrgContext) and hides the row
-- from default rosters. The row still counts against Organization.seat_limit
-- until a future hard-purge job runs.

ALTER TABLE "User" ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "User_org_id_deleted_at_idx" ON "User"("org_id", "deleted_at");
