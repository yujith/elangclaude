-- CreateEnum
CREATE TYPE "ScheduleMode" AS ENUM ('OneOff', 'Recurring');

-- CreateEnum
CREATE TYPE "ScheduleFrequency" AS ENUM ('Daily', 'Weekly');

-- CreateEnum
CREATE TYPE "GenerationRunTrigger" AS ENUM ('Scheduled', 'Manual');

-- CreateEnum
CREATE TYPE "GenerationRunStatus" AS ENUM ('Running', 'Succeeded', 'PartialFailure', 'Failed');

-- CreateEnum
CREATE TYPE "RunItemOutcome" AS ENUM ('Published', 'PendingHumanReview', 'Failed');

-- CreateTable
CREATE TABLE "AutomationSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "generation_enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_publish_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationSchedule" (
    "id" TEXT NOT NULL,
    "section" "Section" NOT NULL,
    "track" "Track" NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 3,
    "part" INTEGER,
    "task_kind" TEXT,
    "topic_hint" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "mode" "ScheduleMode" NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Australia/Sydney',
    "run_at" TIMESTAMP(3),
    "frequency" "ScheduleFrequency",
    "weekday" INTEGER,
    "run_hour" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "created_by" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationRun" (
    "id" TEXT NOT NULL,
    "schedule_id" TEXT,
    "trigger" "GenerationRunTrigger" NOT NULL,
    "status" "GenerationRunStatus" NOT NULL DEFAULT 'Running',
    "section" "Section" NOT NULL,
    "track" "Track" NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "requested_count" INTEGER NOT NULL,
    "published_count" INTEGER NOT NULL DEFAULT 0,
    "pending_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "auto_publish" BOOLEAN NOT NULL,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_by" TEXT,

    CONSTRAINT "GenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationRunItem" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "test_id" TEXT,
    "outcome" "RunItemOutcome" NOT NULL,
    "attempts" INTEGER NOT NULL,
    "verdicts" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GenerationSchedule_enabled_mode_idx" ON "GenerationSchedule"("enabled", "mode");

-- CreateIndex
CREATE INDEX "GenerationRun_started_at_idx" ON "GenerationRun"("started_at");

-- CreateIndex
CREATE INDEX "GenerationRun_schedule_id_idx" ON "GenerationRun"("schedule_id");

-- CreateIndex
CREATE INDEX "GenerationRunItem_run_id_idx" ON "GenerationRunItem"("run_id");

-- CreateIndex
CREATE INDEX "GenerationRunItem_test_id_idx" ON "GenerationRunItem"("test_id");

-- AddForeignKey
ALTER TABLE "GenerationSchedule" ADD CONSTRAINT "GenerationSchedule_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "GenerationSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRunItem" ADD CONSTRAINT "GenerationRunItem_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "GenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRunItem" ADD CONSTRAINT "GenerationRunItem_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "Test"("id") ON DELETE SET NULL ON UPDATE CASCADE;
