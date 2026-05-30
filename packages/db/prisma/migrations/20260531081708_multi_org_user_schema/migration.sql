-- DropIndex
DROP INDEX "User_clerk_user_id_key";

-- DropIndex
DROP INDEX "User_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "User_org_id_email_key" ON "User"("org_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "User_org_id_clerk_user_id_key" ON "User"("org_id", "clerk_user_id");
