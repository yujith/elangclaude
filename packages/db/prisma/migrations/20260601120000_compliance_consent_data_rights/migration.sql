-- CreateEnum
CREATE TYPE "DataControllerModel" AS ENUM ('CustomerControlled', 'PlatformControlled');

-- CreateEnum
CREATE TYPE "DataResidencyRegion" AS ENUM ('syd1');

-- CreateEnum
CREATE TYPE "AgeAssurance" AS ENUM ('Unknown', 'Adult', 'Minor');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('terms_privacy', 'cookies_functional', 'cookies_analytics', 'voice_recording', 'marketing_email', 'parental');

-- CreateEnum
CREATE TYPE "DataRightType" AS ENUM ('Access', 'Portability', 'Erasure', 'Rectification');

-- CreateEnum
CREATE TYPE "DataRightStatus" AS ENUM ('Pending', 'InProgress', 'Completed', 'Rejected', 'Cancelled');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "controller_model" "DataControllerModel" NOT NULL DEFAULT 'CustomerControlled',
ADD COLUMN     "data_region" "DataResidencyRegion" NOT NULL DEFAULT 'syd1';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "age_assurance" "AgeAssurance" NOT NULL DEFAULT 'Unknown',
ADD COLUMN     "erased_at" TIMESTAMP(3),
ADD COLUMN     "guardian_consent_at" TIMESTAMP(3),
ADD COLUMN     "guardian_email" TEXT;

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "consent_type" "ConsentType" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "policy_version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRightsRequest" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "DataRightType" NOT NULL,
    "status" "DataRightStatus" NOT NULL DEFAULT 'Pending',
    "detail" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilled_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataRightsRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentRecord_org_id_idx" ON "ConsentRecord"("org_id");

-- CreateIndex
CREATE INDEX "ConsentRecord_org_id_user_id_idx" ON "ConsentRecord"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "ConsentRecord_org_id_user_id_consent_type_idx" ON "ConsentRecord"("org_id", "user_id", "consent_type");

-- CreateIndex
CREATE INDEX "DataRightsRequest_org_id_idx" ON "DataRightsRequest"("org_id");

-- CreateIndex
CREATE INDEX "DataRightsRequest_org_id_user_id_idx" ON "DataRightsRequest"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "DataRightsRequest_org_id_status_idx" ON "DataRightsRequest"("org_id", "status");

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRightsRequest" ADD CONSTRAINT "DataRightsRequest_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRightsRequest" ADD CONSTRAINT "DataRightsRequest_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: self-serve orgs are platform-controlled (we are the controller).
-- Org-seat orgs (seeded + invite) stay CustomerControlled (we are the processor).
UPDATE "Organization" SET "controller_model" = 'PlatformControlled' WHERE "provisioned_via" = 'self_serve';
