-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SuperAdmin', 'OrgAdmin', 'Learner');

-- CreateEnum
CREATE TYPE "Track" AS ENUM ('Academic', 'GeneralTraining');

-- CreateEnum
CREATE TYPE "Section" AS ENUM ('Reading', 'Listening', 'Writing', 'Speaking');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('InProgress', 'Submitted', 'Graded', 'Abandoned');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('Draft', 'PendingReview', 'Approved', 'Rejected');

-- CreateEnum
CREATE TYPE "GraderKind" AS ENUM ('AI', 'Human');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('Active', 'Suspended', 'Archived');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seat_limit" INTEGER NOT NULL DEFAULT 0,
    "quota_daily" INTEGER NOT NULL DEFAULT 0,
    "quota_monthly" INTEGER NOT NULL DEFAULT 0,
    "status" "OrgStatus" NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" TEXT NOT NULL,
    "track" "Track" NOT NULL,
    "section" "Section" NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 5,
    "status" "TestStatus" NOT NULL DEFAULT 'Draft',
    "approved_by" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "test_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "correct_answer" JSONB,
    "points" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'Learner',
    "ielts_track" "Track" NOT NULL DEFAULT 'Academic',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "test_id" TEXT NOT NULL,
    "section" "Section" NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'InProgress',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "is_correct" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grade" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "band_overall" DECIMAL(3,1) NOT NULL,
    "criteria_scores_json" JSONB NOT NULL,
    "feedback_text" TEXT,
    "graded_by" "GraderKind" NOT NULL DEFAULT 'AI',
    "graded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "storage_url" TEXT NOT NULL,
    "duration_sec" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotaUsage" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "ai_calls_count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotaUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Test_track_section_status_idx" ON "Test"("track", "section", "status");

-- CreateIndex
CREATE INDEX "Test_approved_by_idx" ON "Test"("approved_by");

-- CreateIndex
CREATE INDEX "Question_test_id_idx" ON "Question"("test_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_org_id_idx" ON "User"("org_id");

-- CreateIndex
CREATE INDEX "User_org_id_createdAt_idx" ON "User"("org_id", "createdAt");

-- CreateIndex
CREATE INDEX "User_org_id_role_idx" ON "User"("org_id", "role");

-- CreateIndex
CREATE INDEX "Attempt_org_id_idx" ON "Attempt"("org_id");

-- CreateIndex
CREATE INDEX "Attempt_org_id_user_id_idx" ON "Attempt"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "Attempt_org_id_createdAt_idx" ON "Attempt"("org_id", "createdAt");

-- CreateIndex
CREATE INDEX "Attempt_org_id_submitted_at_idx" ON "Attempt"("org_id", "submitted_at");

-- CreateIndex
CREATE INDEX "Answer_org_id_idx" ON "Answer"("org_id");

-- CreateIndex
CREATE INDEX "Answer_attempt_id_idx" ON "Answer"("attempt_id");

-- CreateIndex
CREATE INDEX "Answer_question_id_idx" ON "Answer"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "Grade_attempt_id_key" ON "Grade"("attempt_id");

-- CreateIndex
CREATE INDEX "Grade_org_id_idx" ON "Grade"("org_id");

-- CreateIndex
CREATE INDEX "Grade_org_id_createdAt_idx" ON "Grade"("org_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Recording_attempt_id_key" ON "Recording"("attempt_id");

-- CreateIndex
CREATE INDEX "Recording_org_id_idx" ON "Recording"("org_id");

-- CreateIndex
CREATE INDEX "Recording_org_id_createdAt_idx" ON "Recording"("org_id", "createdAt");

-- CreateIndex
CREATE INDEX "QuotaUsage_org_id_idx" ON "QuotaUsage"("org_id");

-- CreateIndex
CREATE INDEX "QuotaUsage_org_id_date_idx" ON "QuotaUsage"("org_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "QuotaUsage_user_id_date_key" ON "QuotaUsage"("user_id", "date");

-- CreateIndex
CREATE INDEX "ActivityLog_org_id_idx" ON "ActivityLog"("org_id");

-- CreateIndex
CREATE INDEX "ActivityLog_org_id_timestamp_idx" ON "ActivityLog"("org_id", "timestamp");

-- CreateIndex
CREATE INDEX "ActivityLog_org_id_user_id_idx" ON "ActivityLog"("org_id", "user_id");

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaUsage" ADD CONSTRAINT "QuotaUsage_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaUsage" ADD CONSTRAINT "QuotaUsage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
