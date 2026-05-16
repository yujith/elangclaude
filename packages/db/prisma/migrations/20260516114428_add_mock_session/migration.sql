-- CreateEnum
CREATE TYPE "MockStatus" AS ENUM ('InProgress', 'Submitted', 'Abandoned');

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "mock_session_id" TEXT;

-- CreateTable
CREATE TABLE "MockSession" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "track" "Track" NOT NULL,
    "status" "MockStatus" NOT NULL DEFAULT 'InProgress',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MockSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MockSession_org_id_idx" ON "MockSession"("org_id");

-- CreateIndex
CREATE INDEX "MockSession_org_id_user_id_idx" ON "MockSession"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "MockSession_org_id_status_idx" ON "MockSession"("org_id", "status");

-- CreateIndex
CREATE INDEX "Attempt_mock_session_id_idx" ON "Attempt"("mock_session_id");

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_mock_session_id_fkey" FOREIGN KEY ("mock_session_id") REFERENCES "MockSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockSession" ADD CONSTRAINT "MockSession_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockSession" ADD CONSTRAINT "MockSession_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
